/**
 * POST /api/analyze/:callId -> Analysis
 *
 * Run or re-run the eval pipeline for one real call. Loads the call's enriched
 * agent + normalized transcript, then drives `analyzeCall` (criteria → checkpoints
 * → labeling → conformance → per-checkpoint drift → LLM findings/recs, persisted).
 * Idempotent via the transcriptHash cache; pass `{ force: true }` to bypass it.
 *
 * Single-flight: while a call is being analyzed a `running` AnalysisStatus is
 * persisted; a second trigger for the SAME call returns 409 (with the live status)
 * so the same analysis can't be started twice. As the pipeline advances it writes
 * step-by-step progress into that status record, which the call page polls.
 *
 * 404 when the call, its agent, or its transcript is missing; 409 when already
 * running; 500 on any other analysis failure.
 */
import { analyzeCall } from '../../services/eval/analysis'
import { getAgent, getAnalysisStatus, getCall, getTranscript } from '../../services/db'
import {
  beginStatus,
  finishStatus,
  isActivelyRunning,
  makeProgress
} from '../../services/eval/analysisStatus'
import type { Analysis } from '#shared/types'

export default defineEventHandler(async (event): Promise<Analysis> => {
  const callId = getRouterParam(event, 'callId')
  if (!callId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing callId' })
  }

  const body = await readBody<{ force?: boolean }>(event).catch(() => ({} as { force?: boolean }))
  const force = Boolean(body?.force)

  // ── single-flight guard: refuse a duplicate concurrent run ──
  const existingStatus = await getAnalysisStatus(callId)
  if (isActivelyRunning(existingStatus, Date.now())) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Analysis already running for this call',
      data: existingStatus
    })
  }

  const call = await getCall(callId)
  if (!call) {
    throw createError({ statusCode: 404, statusMessage: `Call ${callId} not found` })
  }

  const [agent, transcript] = await Promise.all([
    getAgent(call.agentId),
    getTranscript(callId)
  ])
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent ${call.agentId} for call ${callId} not found` })
  }
  if (!transcript) {
    throw createError({ statusCode: 404, statusMessage: `Transcript for call ${callId} not found` })
  }

  const clock = () => new Date().toISOString()
  await beginStatus(callId, clock())
  const onProgress = makeProgress(callId, clock)

  try {
    const { analysis } = await analyzeCall(agent, transcript, { force, onProgress })
    await finishStatus(
      callId,
      { state: 'done', provider: analysis.provider, model: analysis.model },
      clock()
    )
    return analysis
  } catch (err) {
    const message = (err as Error).message
    await finishStatus(callId, { state: 'error', error: message }, clock())
    throw createError({
      statusCode: 500,
      statusMessage: `Analysis failed: ${message}`
    })
  }
})
