import { createHash, randomUUID } from 'node:crypto'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { AnalysisResultSchema } from '#shared/types'
import type { Agent, Analysis, AnalysisResult, ExpectedFlow, Transcript } from '#shared/types'
import { getAgent, getAnalysis, getCall, getTranscript, upsertAnalysis, upsertCall } from './db'
import { ensureCriteria } from './criteria'
import { ensureExpectedFlow } from './flow'
import { alignFlow } from './conformance'
import { getProvider } from './llm'

// No name argument: keeps the root as a plain { type: "object", ... } schema,
// which is what Anthropic's input_schema and Ollama's `format` both require.
// (Passing a name produces a { $ref, definitions } wrapper, which they reject.)
const ANALYSIS_JSON_SCHEMA = hardenSchema(zodToJsonSchema(AnalysisResultSchema) as JsonSchemaNode)

/** Minimal navigable JSON-schema shape for the hardening pass below. */
interface JsonSchemaNode {
  type?: string
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
  required?: string[]
  minItems?: number
  default?: unknown
  [k: string]: unknown
}

/**
 * zod's `.default([])` makes array fields optional in the generated JSON schema,
 * so models (and Ollama's `format`) happily omit them and zod backfills `[]` —
 * losing the transcript citations and flow labels the UI/conformance rely on.
 * Force the load-bearing arrays required + non-empty in the schema we hand the LLM.
 */
function hardenSchema(schema: JsonSchemaNode): JsonSchemaNode {
  const props = schema.properties ?? {}
  const evidence = props.findings?.items?.properties?.evidenceTurnIdxs
  const findingItems = props.findings?.items
  if (evidence && findingItems) {
    evidence.minItems = 1
    delete evidence.default
    const req = findingItems.required ?? (findingItems.required = [])
    if (!req.includes('evidenceTurnIdxs')) req.push('evidenceTurnIdxs')
  }
  if (props.stageLabels) {
    props.stageLabels.minItems = 1
    delete props.stageLabels.default
    const root = schema.required ?? (schema.required = [])
    if (!root.includes('stageLabels')) root.push('stageLabels')
  }
  return schema
}

const SYSTEM_PROMPT = [
  'You are a meticulous Voice AI QA analyst. You review a voice agent\'s call transcript',
  'against its goal, script, and success criteria, and produce a structured evaluation.',
  '',
  'Definitions:',
  '- deviation: the agent departed from its script or intended behavior (skipped a step,',
  '  wrong order, off-policy phrasing).',
  '- failure: the agent failed to achieve a required outcome or mishandled the call',
  '  (unresolved problem, lost the customer, broke compliance).',
  '- missed_opportunity: the agent could have advanced the goal but did not (ignored a',
  '  buying signal, did not upsell or schedule when invited to).',
  '',
  'Severity rubric:',
  '- low: minor, cosmetic, or low-impact on the outcome.',
  '- medium: meaningfully hurt the call or customer experience.',
  '- high: caused (or nearly caused) the goal to fail, or a compliance/relationship risk.',
  '',
  'Rules:',
  '- Cite evidence strictly by turn index (the [N] markers). NEVER invent turn indexes.',
  '- Every finding MUST set evidenceTurnIdxs to a NON-EMPTY array of the specific [N] turn',
  '  indexes that prove it (e.g. [3, 4]). Never leave evidenceTurnIdxs empty.',
  '- Every finding references the criterionId it relates to when applicable.',
  '- Score each criterion 0-100 with a one-line evidence note, and give an overall 0-100.',
  '- Recommendations must be paste-ready and target prompt | script | agent_config | training.',
  '- Use Actions flag a TIGHT turnRange [start,end] (usually 1-4 turns) pinpointing the exact',
  '  moment that needs human review|coach_agent|update_script|escalate. Never span the whole call.',
  '  Emit at most 3 use actions, only for the segments that genuinely need a human.',
  '- stageLabels: for EVERY agent turn, map it to the EXPECTED-FLOW node it enacts. Output one',
  '  entry per agent turn: { turnIdx, nodeId (the exact id from the Expected flow list, or null',
  '  if the turn matches no designed node), kind (the node kind, or your best-fit kind) }. Use the',
  '  provided node ids verbatim. This is how we measure whether the call followed the design.',
  '- Be precise and grounded; do not hallucinate content that is not in the transcript.'
].join('\n')

/**
 * Run (or re-run) analysis for a single call.
 *
 * Loads the call, its agent, and transcript; ensures the agent has success
 * criteria; computes a transcript hash; returns a cached analysis when the hash
 * matches and `force` is not set; otherwise prompts the provider, validates the
 * result with zod, backfills ids and the callId, persists the Analysis, links it
 * onto the Call, and returns it.
 *
 * @throws Error with `statusCode` 404 when the call/transcript is missing.
 */
export async function analyzeCall(callId: string, force = false): Promise<Analysis> {
  const call = await getCall(callId)
  if (!call) {
    throw notFound(`Call ${callId} not found`)
  }

  const agentRecord = await getAgent(call.agentId)
  if (!agentRecord) {
    throw notFound(`Agent ${call.agentId} for call ${callId} not found`)
  }

  const transcript = await getTranscript(callId)
  if (!transcript) {
    throw notFound(`Transcript for call ${callId} not found`)
  }

  const provider = await getProvider()
  const agent = await ensureCriteria(agentRecord, provider)
  const flow = await ensureExpectedFlow(agent, provider)

  const transcriptHash = hashTranscript(transcript)

  if (!force) {
    const cached = await getAnalysis(callId)
    if (cached && cached.transcriptHash === transcriptHash) {
      return cached
    }
  }

  const user = buildUserPrompt(agent, transcript, flow)

  const raw = await provider.complete({
    system: SYSTEM_PROMPT,
    user,
    schema: ANALYSIS_JSON_SCHEMA,
    schemaName: 'AnalysisResult'
  })

  const result: AnalysisResult = AnalysisResultSchema.parse(raw)

  // Backfill missing finding ids, recording old->new so recommendation
  // findingIds (which reference the provider's original ids) can be remapped.
  const idRemap = new Map<string, string>()
  const findings = result.findings.map((f) => {
    const oldId = f.id?.trim() ?? ''
    const id = oldId || randomUUID()
    if (oldId) idRemap.set(oldId, id)
    return { ...f, id }
  })

  const recommendations = result.recommendations.map(r => ({
    ...r,
    id: r.id && r.id.trim() ? r.id : randomUUID(),
    // Remap references through any backfilled ids; drop ids that match no finding.
    findingIds: r.findingIds
      .map(fid => idRemap.get(fid) ?? fid)
      .filter(fid => findings.some(f => f.id === fid))
  }))

  const useActions = result.useActions.map(u => ({
    ...u,
    id: u.id && u.id.trim() ? u.id : randomUUID(),
    callId
  }))

  // Align the LLM-labeled actual path against the expected flow (deterministic).
  // Only agent turns enact flow nodes — drop any labels on customer turns.
  const agentTurnIdxs = new Set(transcript.turns.filter(t => t.speaker === 'agent').map(t => t.idx))
  const agentLabels = result.stageLabels.filter(l => agentTurnIdxs.has(l.turnIdx))
  const flowAlignment = alignFlow(flow, agentLabels.length ? agentLabels : result.stageLabels, agent.id, callId)

  const analysis: Analysis = {
    id: randomUUID(),
    callId,
    agentId: agent.id,
    provider: provider.name,
    model: provider.model,
    transcriptHash,
    createdAt: new Date().toISOString(),
    summary: result.summary,
    scorecard: result.scorecard,
    findings,
    recommendations,
    useActions,
    stageLabels: result.stageLabels,
    flowAlignment
  }

  await upsertAnalysis(analysis)
  await upsertCall({ ...call, analysisId: analysis.id })

  return analysis
}

/** Build the turn-indexed user prompt: criteria + expected flow + transcript. */
function buildUserPrompt(agent: Agent, transcript: Transcript, flow: ExpectedFlow): string {
  const criteriaLines = agent.successCriteria
    .map(c => `- id=${c.id} [${c.kind}, weight ${c.weight}] ${c.label}: ${c.detector}`)
    .join('\n')

  const flowLines = flow.nodes
    .map(n => `- nodeId=${n.id} [${n.kind}${n.expected ? '' : ', conditional'}] ${n.label}`)
    .join('\n')

  const turnLines = [...transcript.turns]
    .sort((a, b) => a.idx - b.idx)
    .map(t => `[${t.idx}] ${t.speaker}: ${t.text}`)
    .join('\n')

  return [
    `Agent: ${agent.name}`,
    `Goal: ${agent.goal}`,
    `Script:\n${agent.script || '(no script provided)'}`,
    '',
    'Success criteria:',
    criteriaLines || '(none)',
    '',
    'Expected flow nodes (use these nodeIds verbatim in stageLabels):',
    flowLines || '(none)',
    '',
    'Transcript (turn-indexed):',
    turnLines || '(empty transcript)'
  ].join('\n')
}

/** SHA-256 over the canonical (idx-sorted) transcript JSON. */
function hashTranscript(transcript: Transcript): string {
  const canonical = {
    callId: transcript.callId,
    turns: [...transcript.turns]
      .sort((a, b) => a.idx - b.idx)
      .map(t => ({ idx: t.idx, speaker: t.speaker, text: t.text }))
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function notFound(message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = 404
  return err
}
