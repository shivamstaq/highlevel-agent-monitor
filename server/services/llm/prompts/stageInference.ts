/**
 * PromptSpec: stageInference (R2 §1.4) — infer THIS agent's conversational stage
 * vocabulary.
 *
 * The LLM reads the agent's name, system prompt, business, flow node labels and
 * success-criteria labels and emits 3–8 `StageNode`s describing the conversational
 * phases THIS agent actually moves through (greeting / qualify / collect / confirm
 * / objection / close, etc.). Membership is INFERRED from the real spec — there is
 * deliberately NO hardcoded stage enum; the only constraints are the structural
 * guardrails below (count, unique slug ids, grounded labels).
 *
 * `role: 'reasoner'` (Sonnet, cost-low): inferring a vocabulary from a prompt is a
 * reasoning task. The deterministic `fallback` builds a spine directly from the
 * flow node labels (or a minimal greeting→core→close spine when none exist) so the
 * pipeline always has a valid, grounded vocabulary at zero LLM spend.
 */
import { z } from 'zod'
import type { StageNode } from '#shared/types'
import { StageNodeSchema } from '#shared/types'
import { definePrompt } from './types'

/** Vars contract for the stage-inference prompt. */
export const StageInferenceVarsSchema = z.object({
  agentName: z.string(),
  agentPrompt: z.string(),
  businessName: z.string(),
  /** Display names of the agent's flow nodes (grounding for the spine). */
  flowNodeLabels: z.array(z.string()).default([]),
  /** Labels of the derived success criteria (grounding for obligations). */
  criteriaLabels: z.array(z.string()).default([])
})
export type StageInferenceVars = z.infer<typeof StageInferenceVarsSchema>

/** What the provider emits — the inferred stage vocabulary. */
export const StageInferenceResultSchema = z.object({
  stages: z.array(StageNodeSchema).default([])
})
export type StageInferenceResult = z.infer<typeof StageInferenceResultSchema>

/** Schema name the provider sees — keep stable; the mock keys on it. */
const SCHEMA_NAME = 'AgentStages'

const SYSTEM = [
  'You are a conversation-design analyst for voice AI phone agents.',
  'Given ONE agent\'s real system prompt, its business, its flow node labels and',
  'its success-criteria labels, infer the conversational CHECKPOINTS this specific',
  'agent moves a caller through — the phases a reviewer would segment a call into',
  '(e.g. greeting, understand the need, collect details, confirm, handle objection,',
  'close). The checkpoints MUST be inferred from THIS agent\'s spec, not a fixed',
  'template: include only phases this agent actually performs.',
  '',
  'CRUCIAL FRAMING: a checkpoint is a GOAL the agent should accomplish for the',
  'caller — NOT a script line or an exact phrase. Real callers open, steer, and',
  'skip parts of a conversation in many different ways; a good agent reaches each',
  'goal in whatever way fits the caller. Describe checkpoints by their PURPOSE and',
  'the OUTCOME that means they succeeded, so they can be judged against any',
  'reasonable handling — never as a rigid checklist of words or a fixed order.',
  '',
  'Emit 3 to 8 checkpoints. Each checkpoint needs:',
  '- `id`: a unique lower_snake_case slug.',
  '- `label`: a short human name.',
  '- `kind`: a coarse family slug (your own name, e.g. greeting, qualification,',
  '  data_collection, confirmation, objection, closing).',
  '- `obligation`: "required" (the goal applies to essentially every call) or',
  '  "conditional" (only relevant when the caller takes a certain path).',
  '- `expectation`: ONE sentence describing the PURPOSE of this checkpoint — the',
  '  outcome the agent should ACHIEVE for the caller here — phrased as an intent the',
  '  agent can satisfy in different ways depending on how the caller engages. Focus',
  '  on what good handling accomplishes (e.g. "make the caller feel heard and',
  '  capture why they called"), NOT on exact wording, a specific name, or a fixed',
  '  order. Do not bake in literal script phrases.',
  '- `edgeCases`: 0–3 notable caller situations or interaction styles this',
  '  checkpoint must handle gracefully (e.g. caller already gave their name, caller',
  '  is hostile, caller wants a human, caller jumps straight to the issue), each',
  '  with the `condition` and the `expectedBehavior`. Only include edge cases this',
  '  agent\'s spec actually implies; use [] if none.',
  '',
  'Return ONLY the structured object.'
].join('\n')

function buildUserPrompt(vars: StageInferenceVars): string {
  const nodes = vars.flowNodeLabels.length
    ? vars.flowNodeLabels.map(l => `- ${l}`).join('\n')
    : '(none)'
  const criteria = vars.criteriaLabels.length
    ? vars.criteriaLabels.map(l => `- ${l}`).join('\n')
    : '(none)'
  return [
    `AGENT: ${vars.agentName} @ ${vars.businessName}`,
    '',
    'SYSTEM PROMPT:',
    vars.agentPrompt || '(none)',
    '',
    'FLOW NODE LABELS:',
    nodes,
    '',
    'SUCCESS CRITERIA LABELS:',
    criteria
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/* Guardrails — structural only (no closed-set enum).                          */
/* -------------------------------------------------------------------------- */

/** 3–8 stages, unique non-empty slug ids, every stage grounded + an expectation. */
function stagesGuardrail(out: StageInferenceResult): void {
  const stages = out.stages
  if (stages.length < 3 || stages.length > 8) {
    throw new Error(`stageInference: expected 3–8 stages, got ${stages.length}`)
  }
  const seen = new Set<string>()
  for (const s of stages) {
    if (!s.id.trim()) throw new Error('stageInference: stage id must be non-empty')
    if (!s.label.trim()) throw new Error('stageInference: stage label must be non-empty (grounded)')
    if (!s.kind.trim()) throw new Error('stageInference: stage kind must be non-empty')
    if (!s.expectation.trim()) throw new Error(`stageInference: stage '${s.id}' must carry a concrete expectation`)
    if (seen.has(s.id)) throw new Error(`stageInference: duplicate stage id '${s.id}'`)
    seen.add(s.id)
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback — a grounded spine from the flow node labels.        */
/* -------------------------------------------------------------------------- */

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'stage'
}

/**
 * Build a grounded spine when the LLM is unavailable. Uses the real flow node
 * labels (deduped, capped at the 3–8 guardrail window); if there are too few,
 * pads with a minimal greeting→core→close spine so the output is always valid.
 */
function deterministicStages(vars: StageInferenceVars): StageInferenceResult {
  const seen = new Set<string>()
  const stages: StageNode[] = []

  for (const label of vars.flowNodeLabels) {
    const clean = label.trim()
    if (!clean) continue
    let id = slugify(clean)
    while (seen.has(id)) id = `${id}_${stages.length}`
    seen.add(id)
    stages.push({
      id,
      label: clean,
      kind: id,
      obligation: 'required',
      expectation: `Complete the "${clean}" step of the agent's designed flow.`,
      edgeCases: []
    })
    if (stages.length >= 8) break
  }

  // Pad to the minimum of 3 with a generic conversational spine.
  const spine: Array<{ id: string, label: string, kind: string, expectation: string }> = [
    { id: 'greeting', label: 'Greeting', kind: 'greeting', expectation: 'Greet the caller and state the agent\'s purpose.' },
    { id: 'core', label: 'Core conversation', kind: 'core', expectation: 'Carry out the call\'s main objective with the caller.' },
    { id: 'closing', label: 'Closing', kind: 'closing', expectation: 'Confirm next steps and close the call politely.' }
  ]
  for (const s of spine) {
    if (stages.length >= 3) break
    if (seen.has(s.id)) continue
    seen.add(s.id)
    stages.push({ ...s, obligation: 'required', edgeCases: [] })
  }

  return { stages: stages.slice(0, 8) }
}

export const stageInferencePrompt = definePrompt<StageInferenceVars, StageInferenceResult>({
  id: 'stageInference',
  // v3: expectations reframed as intent/outcome goals (not script lines).
  version: '3.0.0',
  role: 'reasoner',
  mode: 'tool',
  schemaName: SCHEMA_NAME,
  inputSchema: StageInferenceVarsSchema,
  outputSchema: StageInferenceResultSchema,
  system: () => SYSTEM,
  user: vars => buildUserPrompt(vars),
  guardrails: [stagesGuardrail],
  fallback: vars => deterministicStages(vars),
  maxTokens: 2048
})
