/**
 * GET /api/analyze/:callId/status -> AnalysisStatus | null
 *
 * The live, reactive progress record the call page polls while an analysis runs.
 * Returns null (200) when no run has ever been recorded for the call. A `running`
 * status that has gone stale (no progress for STALE_MS) is reported as `error` so
 * the UI stops waiting on an abandoned run.
 */
import { getAnalysisStatus } from '../../../services/db'
import { isActivelyRunning, STALE_MS } from '../../../services/eval/analysisStatus'
import type { AnalysisStatus } from '#shared/types'

export default defineEventHandler(async (event): Promise<AnalysisStatus | null> => {
  const callId = getRouterParam(event, 'callId')
  if (!callId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing callId' })
  }

  const status = await getAnalysisStatus(callId)
  if (!status) return null

  // Surface an abandoned run as an error so the client stops polling forever.
  if (status.state === 'running' && !isActivelyRunning(status, Date.now())) {
    return {
      ...status,
      state: 'error',
      error: `Analysis stalled (no progress for over ${Math.round(STALE_MS / 1000)}s).`
    }
  }

  return status
})
