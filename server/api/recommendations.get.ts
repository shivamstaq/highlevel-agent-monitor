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
 *
 * HOT READ PATH: reads ONLY the write-time index records via getItem
 * (`index:fleet`, `index:agents`, `index:calls`) — ZERO getKeys / list / getAnalysis.
 * `topRecommendations` runs over the compact AnalysisSummary projections held in
 * `index:fleet`; the agents/calls indexes supply the deep-link sources. The
 * agentId scope is applied in memory over the summaries. Empty KV -> [].
 */
import { getAgentsIndex, getCallsIndex, getFleetIndex } from '../services/db'
import { topRecommendations } from '../utils/rollup'
import type { RecommendationItem } from '#shared/types'

const SEVERITY_RANK = { low: 0, medium: 1, high: 2 } as const

export default defineEventHandler(async (event): Promise<RecommendationItem[]> => {
  const query = getQuery(event)
  const agentId = typeof query.agentId === 'string' && query.agentId ? query.agentId : undefined

  const [fleetIndex, agentsIndex, callsIndex] = await Promise.all([
    getFleetIndex(),
    getAgentsIndex(),
    getCallsIndex()
  ])

  // Only the (optionally agent-scoped) analyses contribute, so the queue can
  // never surface advice from a call outside the requested scope.
  let summaries = Object.values(fleetIndex?.summaries ?? {})
  if (agentId) summaries = summaries.filter(s => s.agentId === agentId)

  const agentsById = new Map(Object.values(agentsIndex.agents).map(a => [a.ghl.id, a]))
  const callsById = new Map(Object.values(callsIndex.calls).map(c => [c.id, c]))

  // Full deduped list (no cap), then re-rank by impact, then source recency.
  const items = topRecommendations(summaries, Infinity, { agentsById, callsById })

  return items.sort((a, b) => {
    const impactDiff
      = SEVERITY_RANK[b.recommendation.impact] - SEVERITY_RANK[a.recommendation.impact]
    if (impactDiff !== 0) return impactDiff
    // Most recent source call first; items without a known time sort last.
    return (b.callCreatedAt ?? '').localeCompare(a.callCreatedAt ?? '')
  })
})
