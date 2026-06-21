/**
 * GET /api/agents/:id/flow -> ExpectedFlow
 *
 * The agent's expected call flow. Lazily generated on first read (so the three
 * seeded agents, created before this feature, also get a flow) and cached by
 * specHash thereafter. 404 if the agent does not exist.
 */
import { getAgent } from '../../../services/db'
import { ensureCriteria } from '../../../services/criteria'
import { ensureExpectedFlow } from '../../../services/flow'
import { getProvider } from '../../../services/llm'
import type { ExpectedFlow } from '#shared/types'

export default defineEventHandler(async (event): Promise<ExpectedFlow> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent id' })
  }

  const agent = await getAgent(id)
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent ${id} not found` })
  }

  const provider = await getProvider()
  const withCriteria = await ensureCriteria(agent, provider)
  return ensureExpectedFlow(withCriteria, provider)
})
