/**
 * PromptSpec: flowAlignment (R3) — overlay ONE call's drift onto the agent's
 * inferred call flow.
 *
 * Given the agent's intended-flow graph (atomic nodes: say / ask / decide / do /
 * handoff / end) and this call's transcript, the model decides, per node, whether
 * the call followed it (on_track), deviated (drifted), skipped it (skipped) or
 * never reached it (not_reached) — judging HANDLING, not script wording — and,
 * where the agent went off the intended flow, emits a `tangent` describing what it
 * did instead and how it should have re-aligned. This is what paints the
 * flow-drift graph + drives the per-node insight panel.
 *
 * `role: 'reasoner'` (Sonnet). Deterministic `fallback` marks nodes not_reached
 * with no tangents (honest, uninformative) so the graph still renders.
 */
import { z } from 'zod'
import type { FlowAlignmentStatus, FlowNodeAlignment, FlowTangent } from '#shared/types'
import { FlowNodeAlignmentSchema, FlowTangentSchema } from '#shared/types'
import { definePrompt } from './types'

const FlowNodeInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  description: z.string().default('')
})

const FlowEdgeInputSchema = z.object({
  source: z.string(),
  target: z.string(),
  condition: z.string().optional()
})

const TurnInputSchema = z.object({
  idx: z.number().int().nonnegative(),
  role: z.enum(['agent', 'customer']),
  content: z.string()
})

export const FlowAlignmentVarsSchema = z.object({
  agentName: z.string(),
  businessName: z.string(),
  flowSummary: z.string().default(''),
  nodes: z.array(FlowNodeInputSchema),
  edges: z.array(FlowEdgeInputSchema).default([]),
  turns: z.array(TurnInputSchema),
  maxEntryIdx: z.number().int().nonnegative().default(0)
})
export type FlowAlignmentVars = z.infer<typeof FlowAlignmentVarsSchema>

export const FlowAlignmentResultSchema = z.object({
  summary: z.string().default(''),
  nodeAlignments: z.array(FlowNodeAlignmentSchema).default([]),
  tangents: z.array(FlowTangentSchema).default([])
})
export type FlowAlignmentResult = z.infer<typeof FlowAlignmentResultSchema>

const SCHEMA_NAME = 'FlowAlignment'

const SYSTEM = [
  'You are an expert QA reviewer for voice AI phone agents. You judge how well a',
  'real call followed the agent\'s INTENDED call flow — by handling quality, not',
  'script wording.',
  '',
  'You are given the intended flow as a directed graph of atomic nodes (each a step',
  'or decision the agent should take, with branch conditions on edges) and the',
  'transcript of ONE call.',
  '',
  'For EVERY node, emit a `nodeAlignments` entry:',
  '- `nodeId`: the node id.',
  '- `status`:',
  '    "on_track"    — the call reached this node and the agent handled it as',
  '                    intended (any reasonable wording counts).',
  '    "drifted"     — the agent engaged this node but deviated from the intent in',
  '                    a way that mattered.',
  '    "skipped"     — the call clearly should have hit this node on its path but',
  '                    the agent did not.',
  '    "not_reached" — this node is on a branch the caller never took (not the',
  '                    agent\'s fault). Prefer this over "skipped" when the path',
  '                    simply did not apply.',
  '- `actual`: ONE sentence on what the agent actually did here (or that the path',
  '   did not apply). Grounded in the transcript.',
  '- `recommendation`: for drifted/skipped, ONE sentence on how it SHOULD have',
  '   handled it — e.g. re-align to a specific intended node, or follow the prompt',
  '   instruction. Empty for on_track / not_reached.',
  '- `evidenceEntryIdxs`: real transcript entry idxs that justify the verdict',
  '   (required for on_track/drifted).',
  '',
  'Then, where the agent went OFF the intended flow entirely (did something the',
  'graph does not contain), emit a `tangents` entry:',
  '- `afterNodeId`: the last intended node the agent was on before going off-script.',
  '- `label`: a few words naming what it did instead (e.g. booked the appointment).',
  '- `description`: ONE sentence of detail.',
  '- `recommendation`: how it should have re-aligned (which intended node / per the',
  '   agent\'s instructions).',
  '- `evidenceEntryIdxs`: the transcript idxs of the off-script behavior.',
  'Only emit tangents for genuine off-flow behavior; use [] if the call stayed on',
  'the intended graph.',
  '',
  'Output ONLY the structured object.'
].join('\n')

function clip(s: string, n = 320): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function buildUserPrompt(vars: FlowAlignmentVars): string {
  const nodes = vars.nodes
    .map(n => `  - [${n.id}] (${n.kind}) ${n.label}: ${n.description}`)
    .join('\n')
  const edges = vars.edges.length
    ? vars.edges.map(e => `  ${e.source} -> ${e.target}${e.condition ? ` [when: ${e.condition}]` : ''}`).join('\n')
    : '  (linear)'
  const turns = vars.turns.length
    ? vars.turns.map(t => `  #${t.idx} ${t.role}: ${clip(t.content)}`).join('\n')
    : '  (no spoken turns)'
  return [
    `AGENT: ${vars.agentName} @ ${vars.businessName}`,
    vars.flowSummary ? `INTENDED FLOW: ${vars.flowSummary}` : '',
    '',
    'INTENDED FLOW NODES:',
    nodes,
    '',
    'INTENDED FLOW EDGES:',
    edges,
    '',
    `TRANSCRIPT (entry idx 0–${vars.maxEntryIdx}):`,
    turns
  ].filter(Boolean).join('\n')
}

function alignmentGuardrail(out: FlowAlignmentResult, vars: FlowAlignmentVars): void {
  const ids = new Set(vars.nodes.map(n => n.id))
  const covered = new Set<string>()
  for (const a of out.nodeAlignments) {
    if (!ids.has(a.nodeId)) throw new Error(`flowAlignment: alignment for unknown node '${a.nodeId}'`)
    covered.add(a.nodeId)
    for (const idx of a.evidenceEntryIdxs) {
      if (idx < 0 || idx > vars.maxEntryIdx) throw new Error(`flowAlignment: '${a.nodeId}' cites out-of-range entry #${idx}`)
    }
  }
  for (const id of ids) {
    if (!covered.has(id)) throw new Error(`flowAlignment: missing alignment for node '${id}'`)
  }
  for (const t of out.tangents) {
    if (!ids.has(t.afterNodeId)) throw new Error(`flowAlignment: tangent afterNodeId '${t.afterNodeId}' unknown`)
    if (!t.label.trim()) throw new Error('flowAlignment: tangent label must be non-empty')
  }
}

function deterministicAlignment(vars: FlowAlignmentVars): FlowAlignmentResult {
  const nodeAlignments: FlowNodeAlignment[] = vars.nodes.map(n => ({
    nodeId: n.id,
    status: 'not_reached' as FlowAlignmentStatus,
    actual: 'Flow alignment was not evaluated for this call.',
    recommendation: '',
    evidenceEntryIdxs: []
  }))
  const tangents: FlowTangent[] = []
  return { summary: 'Flow alignment unavailable.', nodeAlignments, tangents }
}

export const flowAlignmentPrompt = definePrompt<FlowAlignmentVars, FlowAlignmentResult>({
  id: 'flowAlignment',
  version: '1.0.0',
  role: 'reasoner',
  mode: 'tool',
  schemaName: SCHEMA_NAME,
  inputSchema: FlowAlignmentVarsSchema,
  outputSchema: FlowAlignmentResultSchema,
  system: () => SYSTEM,
  user: vars => buildUserPrompt(vars),
  guardrails: [alignmentGuardrail],
  fallback: vars => deterministicAlignment(vars),
  maxTokens: 8000
})
