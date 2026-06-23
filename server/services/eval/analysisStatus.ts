// CREATED (our eval layer) — R3 reactive analysis progress + single-flight guard.
/**
 * Analysis run status orchestration. Owns the canonical ordered step list, the
 * progress callback the analyze pipeline emits into, and the persisted
 * `AnalysisStatus` record (via db.ts) that the call page polls.
 *
 * Single-flight: a call whose status is `running` and recently updated cannot be
 * re-triggered (the endpoint returns 409). A run that stopped updating for longer
 * than STALE_MS is considered abandoned (crash / cold worker) and may be retried.
 */
import type { AnalysisStatus, AnalysisStep, AnalysisStepState } from '#shared/types'
import { getAnalysisStatus, setAnalysisStatus } from '../db'

/** Canonical, ordered pipeline steps shown in the progress UI. */
export const ANALYSIS_STEPS: ReadonlyArray<{ id: string, label: string }> = [
  { id: 'criteria', label: 'Deriving success criteria' },
  { id: 'checkpoints', label: 'Identifying conversational checkpoints' },
  { id: 'labeling', label: 'Mapping the transcript to checkpoints' },
  { id: 'conformance', label: 'Aligning expected vs actual flow' },
  { id: 'drift', label: 'Judging per-checkpoint drift' },
  { id: 'scoring', label: 'Scoring the call & writing findings' }
]

export type AnalysisStepId = (typeof ANALYSIS_STEPS)[number]['id']

/** A run is "stale" (abandoned) if it hasn't advanced in this long. */
export const STALE_MS = 3 * 60 * 1000

/** Progress callback the pipeline calls as each step starts/finishes. */
export type ProgressFn = (
  id: AnalysisStepId,
  state: AnalysisStepState,
  detail?: string
) => Promise<void> | void

function freshSteps(): AnalysisStep[] {
  return ANALYSIS_STEPS.map(s => ({ id: s.id, label: s.label, state: 'pending' as const }))
}

/** True when the call is currently being analyzed by a live (non-stale) run. */
export function isActivelyRunning(status: AnalysisStatus | null, now: number): boolean {
  if (!status || status.state !== 'running') return false
  return now - Date.parse(status.updatedAt) < STALE_MS
}

/** Create + persist a fresh `running` status with all steps pending. */
export async function beginStatus(callId: string, nowIso: string): Promise<AnalysisStatus> {
  const status: AnalysisStatus = {
    callId,
    state: 'running',
    steps: freshSteps(),
    startedAt: nowIso,
    updatedAt: nowIso
  }
  return setAnalysisStatus(status)
}

/**
 * Build a ProgressFn bound to this call. Each emit patches the matching step's
 * state (and marks any earlier still-pending steps done, so a skipped step never
 * strands the bar) and bumps `updatedAt`. Best-effort: a write failure is logged,
 * never thrown — progress reporting must never break the analysis itself.
 */
export function makeProgress(callId: string, clock: () => string): ProgressFn {
  return async (id, state, detail) => {
    try {
      const current = await getAnalysisStatus(callId)
      if (!current || current.state !== 'running') return
      const targetIdx = current.steps.findIndex(s => s.id === id)
      const steps = current.steps.map((s, i) => {
        if (s.id === id) return { ...s, state, ...(detail ? { detail } : {}) }
        // Earlier pending steps become done once a later one activates.
        if (state === 'active' && i < targetIdx && s.state === 'pending') {
          return { ...s, state: 'done' as const }
        }
        return s
      })
      await setAnalysisStatus({ ...current, steps, updatedAt: clock() })
    } catch (err) {
      console.error(`[analysisStatus] progress write failed for ${callId}:`, err instanceof Error ? err.message : err)
    }
  }
}

/** Mark the run finished (done|error), flushing remaining pending steps. */
export async function finishStatus(
  callId: string,
  outcome: { state: 'done' | 'error', error?: string, provider?: string, model?: string },
  nowIso: string
): Promise<void> {
  try {
    const current = await getAnalysisStatus(callId)
    if (!current) return
    const steps = current.steps.map(s =>
      s.state === 'pending' || s.state === 'active'
        ? { ...s, state: (outcome.state === 'done' ? 'done' : 'error') as AnalysisStepState }
        : s
    )
    await setAnalysisStatus({
      ...current,
      state: outcome.state,
      steps,
      updatedAt: nowIso,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.provider ? { provider: outcome.provider } : {}),
      ...(outcome.model ? { model: outcome.model } : {})
    })
  } catch (err) {
    console.error(`[analysisStatus] finish write failed for ${callId}:`, err instanceof Error ? err.message : err)
  }
}
