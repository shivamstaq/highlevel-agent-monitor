/**
 * GET /api/recommendations -> RecommendationItem[]
 *
 * Fleet-wide fix-queue: every open recommendation across all analyzed calls,
 * deduped to one item per piece of advice and tagged with the source call/agent
 * that best represents it so the UI can deep-link back (W09). Ranked by impact
 * first, then recency of the source call so the freshest high-impact fixes float
 * to the top of the worklist.
 *
 * Query: ?agentId=<id> scopes the queue to a single agent (optional).
 * Tolerates empty storage (returns []).
 */
import { getAnalysis, listAgents, listCalls } from '../services/db'
import { topRecommendations } from '../utils/rollup'
import type { Analysis, RecommendationItem } from '#shared/types'

const SEVERITY_RANK = { low: 0, medium: 1, high: 2 } as const

export default defineEventHandler(async (event): Promise<RecommendationItem[]> => {
  const query = getQuery(event)
  const agentId = typeof query.agentId === 'string' && query.agentId ? query.agentId : undefined

  const [agents, calls] = await Promise.all([
    listAgents(),
    listCalls(agentId ? { agentId } : undefined)
  ])

  // Only the (optionally agent-scoped) calls' analyses contribute, so the queue
  // can never surface advice from a call outside the requested scope.
  const analyses = (await Promise.all(calls.map(c => getAnalysis(c.id))))
    .filter((a): a is Analysis => a != null)

  const agentsById = new Map(agents.map(a => [a.id, a]))
  const callsById = new Map(calls.map(c => [c.id, c]))

  // Full deduped list (no cap), then re-rank by impact, then source recency.
  const items = topRecommendations(analyses, Infinity, { agentsById, callsById })

  return items.sort((a, b) => {
    const impactDiff
      = SEVERITY_RANK[b.recommendation.impact] - SEVERITY_RANK[a.recommendation.impact]
    if (impactDiff !== 0) return impactDiff
    // Most recent source call first; items without a known time sort last.
    return (b.callStartedAt ?? '').localeCompare(a.callStartedAt ?? '')
  })
})
