/**
 * POST /api/agents/:id/flow -> InferredFlow
 *
 * Derive (or return the cached) intended call flow for an agent — the LLM-inferred
 * directed graph of how it SHOULD handle a call, compiled from its prompt. This is
 * independent of any call, so it can be mapped right after sync (zero calls). It
 * grounds on the agent's inferred checkpoints (derived + cached here first) for a
 * richer graph, then caches the flow per-agent (idempotent by spec hash).
 *
 * 404 if the agent is missing. Best-effort on stage inference (the flow still
 * derives from the prompt alone if checkpoints fail).
 */
import { getAgent } from '../../../services/db'
import { inferAgentStages } from '../../../services/eval/stages'
import { getOrDeriveInferredFlow } from '../../../services/eval/inferredFlow'
import type { InferredFlow } from '#shared/types'

export default defineEventHandler(async (event): Promise<InferredFlow> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent id' })
  }

  const agent = await getAgent(id)
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent ${id} not found` })
  }

  // Ensure the conversational checkpoints exist (cached) so the flow is grounded;
  // never block flow derivation on a checkpoint failure.
  try {
    await inferAgentStages(agent)
  } catch (err) {
    console.error(`[agents/:id/flow] stage inference failed for ${id}:`, err instanceof Error ? err.message : err)
  }

  try {
    return await getOrDeriveInferredFlow(agent)
  } catch (err) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not map intended flow: ${(err as Error).message}`
    })
  }
})
