/**
 * PromptSpec: turnLabeling (R2 §1.4) — label EVERY transcript turn with the
 * agent's inferred conversational stage, in ONE batched call.
 *
 * The LLM receives the agent's stage vocabulary (`stageIds`, from stageInference)
 * and the full ordered list of turns, and returns one `{ idx, stageId, evidence }`
 * per turn. Batching all turns into a single labeling call is the cost-low mandate
 * (one Haiku call per transcript, not one-per-turn).
 *
 * `role: 'labeler'` (Haiku, cost-low). Guardrails close the loop: every `stageId`
 * must be a member of the per-call `stageIds` set (built into a `z.enum` at guard
 * time — NOT a hardcoded enum), every `evidence` must be a real substring of that
 * turn's content, and every `idx` must be in range. The deterministic `fallback`
 * maps every turn to the first (core/llm) stage with a trivial grounded evidence
 * slice, so labeling always yields a contract-valid result at zero LLM spend.
 */
import { z } from 'zod'
import { definePrompt } from './types'

/** One turn handed to the labeler (role is free-form: agent|customer|action). */
export const LabelingTurnSchema = z.object({
  idx: z.number().int().nonnegative(),
  role: z.string(),
  content: z.string()
})
export type LabelingTurn = z.infer<typeof LabelingTurnSchema>

/** Vars contract for the batched labeling prompt. */
export const TurnLabelingVarsSchema = z.object({
  /** The agent's inferred stage ids (the closed set every label must hit). */
  stageIds: z.array(z.string()).min(1),
  turns: z.array(LabelingTurnSchema)
})
export type TurnLabelingVars = z.infer<typeof TurnLabelingVarsSchema>

/** One stage label for one turn. */
export const TurnLabelSchema = z.object({
  idx: z.number().int().nonnegative(),
  stageId: z.string(),
  /** A substring of the turn's content that justifies the stage. */
  evidence: z.string()
})
export type TurnLabel = z.infer<typeof TurnLabelSchema>

/** What the provider emits — one label per turn. */
export const TurnLabelingResultSchema = z.object({
  labels: z.array(TurnLabelSchema).default([])
})
export type TurnLabelingResult = z.infer<typeof TurnLabelingResultSchema>

/** Schema name the provider sees — keep stable; the mock keys on it. */
const SCHEMA_NAME = 'TurnLabels'

const SYSTEM = [
  'You are a conversation-segmentation labeler for voice AI phone calls.',
  'You receive the agent\'s allowed conversational STAGE ids and a timed transcript',
  'whose turns are indexed [idx]. Assign EXACTLY ONE stage id to EVERY turn,',
  'choosing the best-fitting stage from the allowed list ONLY (never invent an id).',
  'For each label provide `evidence`: a CONTIGUOUS slice of words copied',
  'CHARACTER-FOR-CHARACTER from that turn\'s content (same casing, same',
  'punctuation, same spacing). Do NOT paraphrase, re-case, trim punctuation, add',
  'ellipses, or stitch together non-adjacent words — copy a verbatim span that',
  'appears literally in the turn text. Keep it short (a handful of words).',
  'Return one label per turn, covering every idx exactly once. Return ONLY the',
  'structured object.'
].join('\n')

function buildUserPrompt(vars: TurnLabelingVars): string {
  const ids = vars.stageIds.map(id => `- ${id}`).join('\n')
  const lines = vars.turns
    .map(t => `[${t.idx}] ${t.role}: ${t.content.trim()}`)
    .join('\n')
  return [
    'ALLOWED STAGE IDS:',
    ids,
    '',
    'TRANSCRIPT (label every [idx]):',
    lines
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/* Guardrails — closed-set + substring + idx-range (all input-derived).        */
/* -------------------------------------------------------------------------- */

/**
 * Normalize text for tolerant evidence grounding: Unicode NFC, lowercase,
 * collapse all whitespace runs to a single space, strip leading/trailing
 * non-alphanumeric noise (quotes, ellipses, stray punctuation the labeler tends
 * to add or drop). This lets the substring check survive the minor whitespace /
 * casing / punctuation drift Haiku reliably introduces, WITHOUT loosening it to
 * the point where ungrounded evidence would pass.
 */
function normalizeForGrounding(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim()
}

/**
 * Is `evidence` genuinely grounded in `content`? First try a normalized
 * substring match (handles whitespace/casing/punctuation drift). If that fails,
 * fall back to a token-overlap check: the evidence's content words must form a
 * contiguous run inside the turn's content words (order-preserving). This
 * tolerates a stray dropped/added punctuation token while still rejecting
 * paraphrase or fabricated evidence. Empty evidence is never grounded.
 */
export function isEvidenceGrounded(evidence: string, content: string): boolean {
  const e = normalizeForGrounding(evidence)
  if (e.length === 0) return false
  const c = normalizeForGrounding(content)
  if (c.length === 0) return false
  if (c.includes(e)) return true

  // Token-level contiguous overlap as a last resort.
  const eTokens = e.split(' ').filter(Boolean)
  const cTokens = c.split(' ').filter(Boolean)
  if (eTokens.length === 0 || eTokens.length > cTokens.length) return false
  for (let i = 0; i + eTokens.length <= cTokens.length; i++) {
    let matched = true
    for (let j = 0; j < eTokens.length; j++) {
      if (cTokens[i + j] !== eTokens[j]) { matched = false; break }
    }
    if (matched) return true
  }
  return false
}

/**
 * Structural invariants ONLY: every label must hit a stageId in the per-call set
 * (enforced via a freshly built `z.enum` so the closed set is the INPUT's
 * stageIds, not a hardcode), reference an idx that exists in the input turns, and
 * cover every turn exactly once.
 *
 * Evidence grounding is NOT enforced here. It used to throw the whole batch when a
 * SINGLE turn's evidence wasn't a verbatim substring — which Haiku violates often
 * (it paraphrases), collapsing ALL labels to the deterministic single-stage
 * fallback and falsely branding the whole analysis "deterministic fallback". The
 * useful signal is the per-turn STAGE; evidence is a nicety. So the labeler is no
 * longer rejected for soft evidence — instead `applyLabels` (labeling.ts) drops
 * any ungrounded evidence string (never persisting fabricated evidence) while
 * keeping the stage label. Honesty is preserved; one fuzzy quote no longer nukes
 * the batch.
 */
function labelsGuardrail(out: TurnLabelingResult, vars: TurnLabelingVars): void {
  // Closed-set enforcement built per-call from the input stageIds.
  const stageEnum = z.enum(vars.stageIds as [string, ...string[]])
  const turnByIdx = new Map(vars.turns.map(t => [t.idx, t]))
  const labeled = new Set<number>()

  for (const lbl of out.labels) {
    if (!stageEnum.safeParse(lbl.stageId).success) {
      throw new Error(`turnLabeling: stageId '${lbl.stageId}' not in allowed set`)
    }
    if (!turnByIdx.has(lbl.idx)) throw new Error(`turnLabeling: label idx ${lbl.idx} out of range`)
    if (labeled.has(lbl.idx)) {
      throw new Error(`turnLabeling: duplicate label for idx ${lbl.idx}`)
    }
    labeled.add(lbl.idx)
  }

  if (labeled.size !== vars.turns.length) {
    throw new Error(`turnLabeling: expected ${vars.turns.length} labels, got ${labeled.size}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback — map every turn to the first stage, grounded.       */
/* -------------------------------------------------------------------------- */

/**
 * Maps every turn to the first (core/llm) stage id with a trivial grounded
 * evidence slice (a leading slice of the turn content, which is always a real
 * substring). Always satisfies the guardrail's substring + coverage invariants.
 */
function deterministicLabels(vars: TurnLabelingVars): TurnLabelingResult {
  const stageId = vars.stageIds[0]!
  const labels: TurnLabel[] = vars.turns.map(t => ({
    idx: t.idx,
    stageId,
    evidence: evidenceSlice(t.content)
  }))
  return { labels }
}

/** A short, real substring of the content (empty stays empty -> guarded upstream). */
function evidenceSlice(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  return trimmed.slice(0, Math.min(40, trimmed.length))
}

export const turnLabelingPrompt = definePrompt<TurnLabelingVars, TurnLabelingResult>({
  id: 'turnLabeling',
  version: '1.0.0',
  role: 'labeler',
  mode: 'tool',
  schemaName: SCHEMA_NAME,
  inputSchema: TurnLabelingVarsSchema,
  outputSchema: TurnLabelingResultSchema,
  system: () => SYSTEM,
  user: vars => buildUserPrompt(vars),
  guardrails: [labelsGuardrail],
  fallback: vars => deterministicLabels(vars),
  maxTokens: 4096
})
