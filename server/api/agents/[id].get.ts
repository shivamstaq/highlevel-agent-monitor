/**
 * GET /api/agents/:id -> { health, calls, recommendations }
 *
 * One agent's health summary, its calls as list-items (newest first), and the
 * deduped recommendations across that agent's analyzed calls. 404 if the agent
 * does not exist.
 */
import { getAgent, getAnalysis, listCalls } from '../../services/db'
import { computeAgentHealth, toCallListItem, topRecommendations } from '../../utils/rollup'
import type { AgentHealth, Analysis, Call, CallListItem, FlowNodeKind, RecommendationItem } from '#shared/types'

/** Aggregate flow-conformance drift across an agent's analyzed calls (the flywheel signal). */
export interface FlowDriftSummary {
  avgConformance: number | null
  callsScored: number
  nodes: { nodeId: string, label: string, kind: FlowNodeKind, skipRate: number, driftRate: number }[]
}

export default defineEventHandler(async (event): Promise<{
  health: AgentHealth
  calls: CallListItem[]
  recommendations: RecommendationItem[]
  flowSummary: FlowDriftSummary
}> => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent id' })
  }

  const agent = await getAgent(id)
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: `Agent ${id} not found` })
  }

  const calls = await listCalls({ agentId: id })
  const analyses = await Promise.all(calls.map(c => getAnalysis(c.id)))

  const analysesByCallId = new Map<string, Analysis>()
  for (const a of analyses) {
    if (a) analysesByCallId.set(a.callId, a)
  }

  const health = computeAgentHealth(agent, calls, analysesByCallId)
  const callItems = calls.map(call =>
    toCallListItem(call, agent.name, analysesByCallId.get(call.id) ?? null)
  )
  const callsById = new Map<string, Call>(calls.map(c => [c.id, c]))
  const recommendations = topRecommendations(
    [...analysesByCallId.values()],
    6,
    { agentsById: new Map([[agent.id, agent]]), callsById }
  )
  const flowSummary = summarizeFlowDrift([...analysesByCallId.values()])

  return { health, calls: callItems, recommendations, flowSummary }
})

/** Per-node skip/drift rates over the agent's analyzed calls. */
function summarizeFlowDrift(analyses: Analysis[]): FlowDriftSummary {
  const scored = analyses.filter(a => a.flowAlignment)
  if (scored.length === 0) return { avgConformance: null, callsScored: 0, nodes: [] }

  const avgConformance = Math.round(
    scored.reduce((s, a) => s + (a.flowAlignment!.conformanceScore), 0) / scored.length
  )

  const agg = new Map<string, { label: string, kind: FlowNodeKind, skipped: number, drifted: number, total: number }>()
  for (const a of scored) {
    for (const n of a.flowAlignment!.nodeAlignments) {
      if (!n.nodeId) continue
      const cur = agg.get(n.nodeId) ?? { label: n.label, kind: n.kind, skipped: 0, drifted: 0, total: 0 }
      cur.total++
      if (n.status === 'skipped' && n.driftScore > 0) cur.skipped++
      if (n.driftScore > 0) cur.drifted++
      agg.set(n.nodeId, cur)
    }
  }

  const nodes = [...agg.entries()]
    .map(([nodeId, v]) => ({
      nodeId,
      label: v.label,
      kind: v.kind,
      skipRate: v.total ? v.skipped / v.total : 0,
      driftRate: v.total ? v.drifted / v.total : 0
    }))
    .filter(n => n.driftRate > 0)
    .sort((a, b) => b.driftRate - a.driftRate)

  return { avgConformance, callsScored: scored.length, nodes }
}
