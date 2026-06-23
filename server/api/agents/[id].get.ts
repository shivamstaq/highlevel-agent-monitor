/**
 * GET /api/agents/:id -> { agent, health, calls, recommendations, inferredFlow,
 * criteriaScorecard }
 *
 * One agent's enriched record, aggregate health, its calls as list-items (newest
 * first), the deduped recurring recommendations, the LLM-inferred intended call
 * flow, and a per-criterion aggregate scorecard. 404 if the agent doesn't exist.
 */
import { getAgent, getAnalysis, getCallsIndex } from '../../services/db'
import { getCachedInferredFlow } from '../../services/eval/inferredFlow'
import { computeAgentHealth, toCallListItem, topRecommendations } from '../../utils/rollup'
import type { Agent, AgentHealth, Analysis, Call, CallListItem, InferredFlow, RecommendationItem } from '#shared/types'

/** One criterion's aggregate performance across the agent's analyzed calls. */
export interface CriterionAggregate {
  criterionId: string
  label: string
  kind: string
  /** Mean score 0–100 over calls that scored this criterion (null if none). */
  avgScore: number | null
  /** Pass rate 0–1 (criterion `met`) over scored calls (null if none). */
  metRate: number | null
  callsScored: number
}

export default defineEventHandler(async (event): Promise<{
  agent: Agent
  health: AgentHealth
  calls: CallListItem[]
  recommendations: RecommendationItem[]
  inferredFlow: InferredFlow | null
  criteriaScorecard: CriterionAggregate[]
}> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent id' })
  }

  const agent = await getAgent(id)
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent ${id} not found` })
  }

  // HOT READ PATH: read the calls from the getItem-based `index:calls` and filter
  // in memory by agentId — NEVER getKeys/list (which would hit the free-tier KV
  // list quota and 500). Per-call analyses are single getItem reads (fine).
  const callsIndex = await getCallsIndex()
  const calls = Object.values(callsIndex.calls)
    .filter(c => c.agentId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const analyses = await Promise.all(calls.map(c => getAnalysis(c.id)))

  const analysesByCallId = new Map<string, Analysis>()
  for (const a of analyses) {
    if (a) analysesByCallId.set(a.callId, a)
  }

  const health = computeAgentHealth(agent, calls, analysesByCallId)
  const callItems = calls.map(call =>
    toCallListItem(call, agent.ghl.agentName, analysesByCallId.get(call.id) ?? null)
  )
  const callsById = new Map<string, Call>(calls.map(c => [c.id, c]))
  const recommendations = topRecommendations(
    [...analysesByCallId.values()],
    6,
    { agentsById: new Map([[agent.ghl.id, agent]]), callsById }
  )
  const criteriaScorecard = aggregateCriteria(agent, [...analysesByCallId.values()])
  const inferredFlow = await getCachedInferredFlow(id)

  return { agent, health, calls: callItems, recommendations, inferredFlow, criteriaScorecard }
})

/** Per-criterion mean score + pass rate across the agent's analyzed calls. */
function aggregateCriteria(agent: Agent, analyses: Analysis[]): CriterionAggregate[] {
  return agent.successCriteria.map((c) => {
    let sum = 0
    let met = 0
    let count = 0
    for (const a of analyses) {
      const cs = a.scorecard.perCriterion.find(p => p.criterionId === c.id)
      if (!cs) continue
      sum += cs.score
      if (cs.met) met += 1
      count += 1
    }
    return {
      criterionId: c.id,
      label: c.label,
      kind: c.kind,
      avgScore: count ? Math.round(sum / count) : null,
      metRate: count ? met / count : null,
      callsScored: count
    }
  })
}
