/**
 * GET /api/calls/:id -> CallDetail
 *
 * Full call drill-down: the call, its agent, the transcript, the analysis
 * (null when the call has not been analyzed yet), the agent's expected call
 * flow, and a modeled event timeline synthesized from the transcript. 404 if the
 * call or its agent is missing. An empty transcript is synthesized when none is
 * stored so the UI never crashes on a partially-ingested call.
 */
import { getAgent, getAnalysis, getCall, getExpectedFlow, getTimeline, getTranscript } from '../../services/db'
import { synthesizeTimeline } from '../../services/timeline'
import type { CallDetail, CallTimeline } from '#shared/types'

export default defineEventHandler(async (event): Promise<CallDetail> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing call id' })
  }

  const call = await getCall(id)
  if (!call) {
    throw createError({ statusCode: 404, statusMessage: `Call ${id} not found` })
  }

  const [agent, transcript, analysis, expectedFlow, ingestedTimeline] = await Promise.all([
    getAgent(call.agentId),
    getTranscript(id),
    getAnalysis(id),
    getExpectedFlow(call.agentId),
    getTimeline(id)
  ])

  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent ${call.agentId} for call ${id} not found` })
  }

  const resolvedTranscript = transcript ?? { callId: id, turns: [] }
  // Prefer a real (ingested) timeline from HighLevel; otherwise model one.
  const timeline: CallTimeline | null = ingestedTimeline
    ?? (resolvedTranscript.turns.length ? synthesizeTimeline(call, resolvedTranscript) : null)

  return {
    call,
    agent,
    transcript: resolvedTranscript,
    analysis: analysis ?? null,
    timeline,
    expectedFlow: expectedFlow ?? null
  }
})
