/**
 * PromptSpec: checkpointDrift (R3) — the PRIMARY analysis output.
 *
 * Given the agent's self-identified conversational CHECKPOINTS (each carrying a
 * concrete agent-level `expectation` + known `edgeCases`) and THIS call's labeled
 * transcript, the model judges, per checkpoint, what the agent was expected to do
 * vs what it actually did — accounting for the caller's interaction style / edge
 * cases — and emits a grounded verdict (met | partial | missed | not_applicable)
 * cited by transcript entry idxs.
 *
 * `role: 'reasoner'` (Sonnet, cost-low): a per-checkpoint expected-vs-actual
 * judgment is a reasoning task. The deterministic `fallback` derives verdicts from
 * the turn→checkpoint labels already attached to the transcript, so the drift view
 * always renders — grounded, honest, zero LLM spend.
 */
import { z } from 'zod'
import type { CheckpointReport } from '#shared/types'
import { CheckpointReportSchema } from '#shared/types'
import { definePrompt } from './types'

/** One checkpoint definition handed to the model (the agent-level expectation). */
const CheckpointInputSchema = z.object({
  stageId: z.string(),
  label: z.string(),
  obligation: z.enum(['required', 'conditional']),
  expectation: z.string(),
  edgeCases: z
    .array(z.object({ condition: z.string(), expectedBehavior: z.string() }))
    .default([])
})

/** One labeled transcript turn (the actual). */
const TurnInputSchema = z.object({
  idx: z.number().int().nonnegative(),
  role: z.enum(['agent', 'customer']),
  content: z.string(),
  /** The checkpoint id the labeler assigned this turn (hint, may be absent). */
  stageId: z.string().optional()
})

export const CheckpointDriftVarsSchema = z.object({
  agentName: z.string(),
  businessName: z.string(),
  /** The agent's goal / system-prompt excerpt for grounding. */
  agentGoal: z.string().default(''),
  checkpoints: z.array(CheckpointInputSchema),
  turns: z.array(TurnInputSchema),
  /** Highest valid transcript entry idx (for evidence clamping/validation). */
  maxEntryIdx: z.number().int().nonnegative().default(0)
})
export type CheckpointDriftVars = z.infer<typeof CheckpointDriftVarsSchema>

export const CheckpointDriftResultSchema = z.object({
  reports: z.array(CheckpointReportSchema).default([])
})
export type CheckpointDriftResult = z.infer<typeof CheckpointDriftResultSchema>

const SCHEMA_NAME = 'CheckpointDrift'

const SYSTEM = [
  'You are an expert QA reviewer for voice AI phone agents. You judge whether the',
  'agent HANDLED THE CALL WELL — not whether it recited a script.',
  '',
  'You are given the agent\'s conversational CHECKPOINTS (each a GOAL the agent',
  'should accomplish, with its purpose in `expectation` and known edge cases) and',
  'the transcript of ONE real call (turns are labeled with the checkpoint they',
  'enacted).',
  '',
  'HOW TO JUDGE — read carefully, this is the whole point:',
  '• Real callers open, steer, interrupt, and skip parts of a conversation in many',
  '  different ways. A great agent adapts and still serves the caller. You are',
  '  grading the agent\'s HANDLING of how THIS caller actually engaged — NOT',
  '  adherence to an exact script, wording, name, or order.',
  '• Judge by OUTCOME and INTENT: did the agent accomplish the PURPOSE of this',
  '  checkpoint for this caller? If yes, it is "met" — even if it used different',
  '  words, a different order, a different name/business, was brief, or reached the',
  '  goal in its own way. Never lower a verdict merely because the phrasing, the',
  '  business name, or the sequence differs from the expectation text.',
  '• Be fair and realistic, the way a good call-center coach would be. Do not invent',
  '  failures. Do not demand things the caller never needed.',
  '',
  'For EACH checkpoint emit a report:',
  '- `stageId` + `label` + `obligation`: copy from the checkpoint.',
  '- `status`:',
  '    "met"            — the agent accomplished this checkpoint\'s purpose for the',
  '                       caller, in any reasonable way.',
  '    "partial"        — it engaged the purpose but left it weak/incomplete in a',
  '                       way that actually mattered to the caller.',
  '    "missed"         — the purpose CLEARLY mattered for THIS caller and the agent',
  '                       genuinely failed to deliver it (a real service failure).',
  '                       Use this sparingly and only for true gaps — never for a',
  '                       wording/order/identity difference.',
  '    "not_applicable" — this checkpoint simply did not apply to how THIS call went',
  '                       (the caller never took the path that needs it, or pre-empted',
  '                       it). When a checkpoint was not relevant to this caller,',
  '                       use not_applicable — NOT missed. When in doubt between',
  '                       missed and not_applicable, choose not_applicable.',
  '- `expected`: ONE sentence on the PURPOSE the agent should have achieved here',
  '   (intent, not a script line).',
  '- `actual`: ONE sentence on how the agent actually handled it for this caller —',
  '   specific and grounded in the transcript (or that the situation never arose).',
  '- `edgeCaseNote`: if the caller engaged in an unusual or edge-case way, one',
  '   sentence on how well the agent adapted; otherwise omit.',
  '- `evidenceEntryIdxs`: the real transcript entry idx numbers that justify your',
  '   verdict. REQUIRED for met/partial. Never invent an index.',
  '',
  'Return EXACTLY one report per checkpoint, in the given order. Output ONLY the',
  'structured object.'
].join('\n')

function clip(s: string, n = 360): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function buildUserPrompt(vars: CheckpointDriftVars): string {
  const checkpoints = vars.checkpoints
    .map((c, i) => {
      const edges = c.edgeCases.length
        ? c.edgeCases.map(e => `      · if ${e.condition} → ${e.expectedBehavior}`).join('\n')
        : '      · (none)'
      return [
        `  ${i + 1}. [${c.stageId}] ${c.label} (${c.obligation})`,
        `     expectation: ${c.expectation}`,
        '     edge cases:',
        edges
      ].join('\n')
    })
    .join('\n')

  const turns = vars.turns.length
    ? vars.turns
        .map(t => `  #${t.idx} ${t.role}${t.stageId ? ` [${t.stageId}]` : ''}: ${clip(t.content)}`)
        .join('\n')
    : '  (no spoken turns)'

  return [
    `AGENT: ${vars.agentName} @ ${vars.businessName}`,
    vars.agentGoal ? `GOAL: ${clip(vars.agentGoal, 600)}` : '',
    '',
    'CHECKPOINTS (expected):',
    checkpoints,
    '',
    `TRANSCRIPT (actual, entry idx 0–${vars.maxEntryIdx}):`,
    turns
  ]
    .filter(Boolean)
    .join('\n')
}

/* -------------------------------------------------------------------------- */
/* Guardrail — coverage, closed-set ids, grounded evidence.                    */
/* -------------------------------------------------------------------------- */

function driftGuardrail(out: CheckpointDriftResult, vars: CheckpointDriftVars): void {
  const wanted = vars.checkpoints.map(c => c.stageId)
  const got = new Set(out.reports.map(r => r.stageId))
  for (const id of wanted) {
    if (!got.has(id)) throw new Error(`checkpointDrift: missing report for checkpoint '${id}'`)
  }
  const known = new Set(wanted)
  for (const r of out.reports) {
    if (!known.has(r.stageId)) throw new Error(`checkpointDrift: report for unknown checkpoint '${r.stageId}'`)
    if (!r.expected.trim()) throw new Error(`checkpointDrift: '${r.stageId}' missing 'expected'`)
    if (!r.actual.trim()) throw new Error(`checkpointDrift: '${r.stageId}' missing 'actual'`)
    for (const idx of r.evidenceEntryIdxs) {
      if (idx < 0 || idx > vars.maxEntryIdx) {
        throw new Error(`checkpointDrift: '${r.stageId}' cites out-of-range entry #${idx}`)
      }
    }
    if ((r.status === 'met' || r.status === 'partial') && r.evidenceEntryIdxs.length === 0) {
      throw new Error(`checkpointDrift: '${r.stageId}' is ${r.status} but cites no transcript evidence`)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback — verdicts from the turn→checkpoint labels.          */
/* -------------------------------------------------------------------------- */

function deterministicDrift(vars: CheckpointDriftVars): CheckpointDriftResult {
  const reports: CheckpointReport[] = vars.checkpoints.map((c) => {
    const matched = vars.turns.filter(t => t.stageId === c.stageId)
    const agentTurns = matched.filter(t => t.role === 'agent')
    const evidence = matched.map(t => t.idx).sort((a, b) => a - b)
    const expected = c.expectation || `Complete the "${c.label}" checkpoint.`

    if (matched.length > 0) {
      return {
        stageId: c.stageId,
        label: c.label,
        obligation: c.obligation,
        status: agentTurns.length > 0 ? 'met' : 'partial',
        expected,
        actual: agentTurns.length > 0
          ? `The agent engaged this checkpoint across ${agentTurns.length} turn${agentTurns.length === 1 ? '' : 's'}.`
          : 'Only the caller touched on this checkpoint; the agent did not lead it.',
        evidenceEntryIdxs: evidence
      }
    }

    return {
      stageId: c.stageId,
      label: c.label,
      obligation: c.obligation,
      status: c.obligation === 'required' ? 'missed' : 'not_applicable',
      expected,
      actual: c.obligation === 'required'
        ? 'No transcript turns were labeled to this checkpoint — it appears skipped.'
        : 'This conditional checkpoint did not apply on this call.',
      evidenceEntryIdxs: []
    }
  })

  return { reports }
}

export const checkpointDriftPrompt = definePrompt<CheckpointDriftVars, CheckpointDriftResult>({
  id: 'checkpointDrift',
  // v2: reframed from script-adherence to handling-quality vs the caller's path.
  version: '2.0.0',
  role: 'reasoner',
  mode: 'tool',
  schemaName: SCHEMA_NAME,
  inputSchema: CheckpointDriftVarsSchema,
  outputSchema: CheckpointDriftResultSchema,
  system: () => SYSTEM,
  user: vars => buildUserPrompt(vars),
  guardrails: [driftGuardrail],
  fallback: vars => deterministicDrift(vars),
  maxTokens: 8000
})
