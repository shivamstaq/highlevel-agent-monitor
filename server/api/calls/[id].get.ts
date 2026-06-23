/**
 * GET /api/calls/:id -> CallDetail
 *
 * Full call drill-down for the Eval tab: the call, its enriched agent, the
 * normalized transcript, the analysis (null when not yet analyzed), and the two
 * CREATED DAGs this call renders alongside the borrowed Call-Flow graph:
 *   - expectedFlow: the should-be DAG (normative + per-call ideal), preferring a
 *     persisted ExpectedFlow and otherwise computing it on read.
 *   - actualFlow:   the as-ran executed-trace DAG built from the transcript.
 *
 * 404 if the call or its agent is missing. An empty transcript is synthesized
 * when none is stored so the UI never crashes on a partially-ingested call; with
 * no transcript entries the actual-flow trace is null (nothing to trace yet).
 */
import { getAgent, getAnalysis, getCall, getExpectedFlow, getTranscript } from '../../services/db'
import { buildNormative, buildPerCall } from '../../services/eval/expectedFlow'
import { buildActualFlow } from '../../services/eval/actualFlow'
import { getCachedInferredFlow } from '../../services/eval/inferredFlow'
import type { ActualFlow, CallDetail, ExpectedFlow, Transcript } from '#shared/types'

export default defineEventHandler(async (event): Promise<CallDetail> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing call id' })
  }

  const call = await getCall(id)
  if (!call) {
    throw createError({ statusCode: 404, statusMessage: `Call ${id} not found` })
  }

  const [agent, transcript, analysis, storedExpected, inferredFlow] = await Promise.all([
    getAgent(call.agentId),
    getTranscript(id),
    getAnalysis(id),
    getExpectedFlow(call.agentId),
    getCachedInferredFlow(call.agentId)
  ])

  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent ${call.agentId} for call ${id} not found` })
  }

  const resolvedTranscript: Transcript = transcript ?? { callId: id, entries: [] }

  // Expected flow: prefer a persisted ExpectedFlow (written by the analyzer), but
  // always ensure a per-call layer scoped to THIS call so the Eval tab can toggle
  // normative vs per-call even for an as-yet-unanalyzed call.
  const expectedFlow: ExpectedFlow = storedExpected && storedExpected.perCall?.callId === id
    ? storedExpected
    : {
        agentId: agent.ghl.id,
        normative: storedExpected?.normative ?? buildNormative(agent),
        ...(resolvedTranscript.entries.length
          ? { perCall: { callId: id, ideal: buildPerCall(agent, resolvedTranscript) } }
          : {})
      }

  // Actual flow: the executed trace. Only meaningful once we have transcript
  // entries. When the call was analyzed, the stored transcript carries the
  // per-turn stage labels and the analysis carries the agent's stage vocabulary, so
  // the trace rebuilds as the SAME multi-node DAG the analyzer produced — no LLM on
  // read. Unanalyzed calls degrade to the single-core trace.
  const actualFlow: ActualFlow | null = resolvedTranscript.entries.length
    ? buildActualFlow(resolvedTranscript, agent.flow, analysis?.stageSet ?? undefined)
    : null

  return {
    call,
    agent,
    transcript: resolvedTranscript,
    analysis: analysis ?? null,
    expectedFlow,
    actualFlow,
    inferredFlow: inferredFlow ?? null
  }
})
