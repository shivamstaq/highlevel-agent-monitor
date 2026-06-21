import { analyzeCall } from '../../services/analysis'
import type { Analysis } from '#shared/types'

/**
 * POST /api/analyze/:callId
 *
 * Run or re-run analysis for one call. Idempotent via transcriptHash caching;
 * pass `{ force: true }` in the body to bypass the cache. Returns the Analysis.
 * Responds 404 when the call (or its agent/transcript) is missing.
 */
export default defineEventHandler(async (event): Promise<Analysis> => {
  const callId = getRouterParam(event, 'callId')
  if (!callId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing callId' })
  }

  const body = await readBody<{ force?: boolean }>(event).catch(() => ({} as { force?: boolean }))
  const force = Boolean(body?.force)

  try {
    return await analyzeCall(callId, force)
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404) {
      throw createError({ statusCode: 404, statusMessage: (err as Error).message })
    }
    throw createError({
      statusCode: 500,
      statusMessage: `Analysis failed: ${(err as Error).message}`
    })
  }
})
