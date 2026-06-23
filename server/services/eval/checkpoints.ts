// CREATED (our eval layer) — R3 primary output.
/**
 * Checkpoint drift — compare, per self-identified conversational checkpoint, what
 * the agent SHOULD have done (the checkpoint's agent-level `expectation`) against
 * what it ACTUALLY did on this call, accounting for per-call edge cases. Runs the
 * `checkpointDrift` prompt over the LABELED transcript; the deterministic fallback
 * (inside the prompt spec) derives verdicts from the turn→checkpoint labels so the
 * drift view always renders.
 *
 * Returns the per-checkpoint reports IN CHECKPOINT ORDER plus provenance meta so
 * the orchestrator can fold `usedFallback` into the persisted Analysis.
 */
import type { Agent, AgentStageSet, CheckpointReport, Transcript } from '#shared/types'
import { generateStructured, type GenerateMeta } from '../llm/generateStructured'

export interface CheckpointDriftOutput {
  checkpoints: CheckpointReport[]
  meta: GenerateMeta
}

const FALLBACK_META: GenerateMeta = {
  provider: 'none',
  model: 'none',
  promptId: 'checkpointDrift',
  promptVersion: '0',
  usedFallback: true
}

export async function runCheckpointDrift(
  agent: Agent,
  stageSet: AgentStageSet | undefined,
  transcript: Transcript
): Promise<CheckpointDriftOutput> {
  const stages = stageSet?.stages ?? []
  // No vocabulary → nothing to compare against (degraded stage inference).
  if (stages.length === 0) {
    return { checkpoints: [], meta: FALLBACK_META }
  }

  const turns = transcript.entries
    .filter((e): e is Extract<typeof e, { role: 'agent' | 'customer' }> =>
      e.role === 'agent' || e.role === 'customer')
    .map(t => ({ idx: t.idx, role: t.role, content: t.content, stageId: t.stageId }))

  const maxEntryIdx = transcript.entries.reduce((m, e) => Math.max(m, e.idx), 0)

  try {
    const { data, meta } = await generateStructured('checkpointDrift', {
      agentName: agent.ghl.agentName,
      businessName: agent.ghl.businessName,
      agentGoal: agent.ghl.agentPrompt,
      checkpoints: stages.map(s => ({
        stageId: s.id,
        label: s.label,
        obligation: s.obligation,
        expectation: s.expectation,
        edgeCases: s.edgeCases
      })),
      turns,
      maxEntryIdx
    })

    // Return reports in the canonical checkpoint order (defensive — guardrail
    // already enforced coverage, but the model may reorder).
    const byId = new Map(data.reports.map(r => [r.stageId, r]))
    const ordered = stages
      .map(s => byId.get(s.id))
      .filter((r): r is CheckpointReport => Boolean(r))

    return { checkpoints: ordered, meta }
  } catch (err) {
    // The seam always falls back internally, so reaching here is unexpected —
    // log loudly and degrade to no checkpoints rather than crash the pipeline.
    console.error(
      `[runCheckpointDrift] failed for agent ${agent.ghl.id}:`,
      err instanceof Error ? err.message : err
    )
    return { checkpoints: [], meta: FALLBACK_META }
  }
}
