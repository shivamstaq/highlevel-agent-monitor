// CREATED (our eval layer)
/**
 * Turn labeling (R2 §1.4) — assign every SPOKEN turn its inferred conversational
 * `stageId` (from the agent's `AgentStageSet`) in ONE batched LLM call.
 *
 * `labelTurns(stageSet, transcript)` collects the spoken turns (agent|customer —
 * `action_executed` entries carry no stage), runs a SINGLE
 * `generateStructured('turnLabeling', { stageIds, turns })` call (role: labeler →
 * Haiku 4.5, cost-low: one call per transcript, never one-per-turn), and returns a
 * `Map<idx, { stageId, evidence }>`. The prompt's guardrails enforce closed-set
 * stageIds (a per-call `z.enum` over `stageSet.stages`), substring-grounded
 * evidence, and full coverage; its deterministic fallback maps every turn to the
 * first stage, so labeling always yields a valid result at zero LLM spend.
 *
 * `applyLabels(transcript, labels)` returns a NEW transcript whose spoken entries
 * carry `stageId`/`evidence`; actions pass through unchanged. The labeled
 * transcript is what `actualFlow.ts` walks to build the multi-node executed trace.
 */
import type { Transcript, TranscriptEntry, AgentStageSet, TurnEntry } from '#shared/types'
import { TranscriptSchema } from '#shared/types'
import { generateStructured, type GenerateMeta } from '../llm/generateStructured'
import { isEvidenceGrounded } from '../llm/prompts/turnLabeling'

export interface TurnLabel {
  stageId: string
  evidence: string
}

export interface LabelTurnsResult {
  /** idx → { stageId, evidence } for every spoken turn. */
  labels: Map<number, TurnLabel>
  /** Provenance for the single labeling call. */
  meta: GenerateMeta
}

/**
 * Label every spoken turn with its conversational stage in one batched call.
 * Returns an empty map (no LLM call) when there are no spoken turns or the stage
 * set is empty — there is nothing to label.
 */
export async function labelTurns(
  stageSet: AgentStageSet,
  transcript: Transcript
): Promise<LabelTurnsResult> {
  const stageIds = stageSet.stages.map(s => s.id)
  const turns = transcript.entries
    .filter(isTurn)
    .map(t => ({ idx: t.idx, role: t.role, content: t.content }))

  const labels = new Map<number, TurnLabel>()

  if (stageIds.length === 0 || turns.length === 0) {
    return {
      labels,
      meta: {
        provider: 'none',
        model: 'none',
        promptId: 'turnLabeling',
        promptVersion: '0',
        usedFallback: true
      }
    }
  }

  const { data, meta } = await generateStructured('turnLabeling', { stageIds, turns })
  for (const lbl of data.labels) {
    labels.set(lbl.idx, { stageId: lbl.stageId, evidence: lbl.evidence })
  }

  return { labels, meta }
}

/**
 * Project the labels back onto the transcript, returning a NEW (validated)
 * transcript whose spoken entries carry `stageId`/`evidence`. Actions and unlabeled
 * turns pass through unchanged.
 */
export function applyLabels(
  transcript: Transcript,
  labels: Map<number, TurnLabel>
): Transcript {
  const entries: TranscriptEntry[] = transcript.entries.map((e) => {
    if (e.role === 'action') return e
    const lbl = labels.get(e.idx)
    if (!lbl) return e
    // Keep the stage label, but only persist evidence that is genuinely grounded
    // in the turn (never store a fabricated/paraphrased quote — honesty).
    const evidence = isEvidenceGrounded(lbl.evidence, e.content) ? lbl.evidence : undefined
    return { ...e, stageId: lbl.stageId, ...(evidence ? { evidence } : {}) }
  })
  return TranscriptSchema.parse({ callId: transcript.callId, entries })
}

function isTurn(e: TranscriptEntry): e is TurnEntry {
  return e.role === 'agent' || e.role === 'customer'
}
