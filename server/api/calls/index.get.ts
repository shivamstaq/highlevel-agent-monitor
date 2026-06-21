/**
 * GET /api/calls -> CallListItem[]
 *
 * Filterable call list. Query params:
 *   - agentId:  only calls for this agent
 *   - severity: only calls whose top finding severity equals this (low|medium|high)
 *   - outcome:  only calls whose Call.outcome equals this (case-insensitive)
 *
 * Calls without an analysis yet are surfaced with score/topSeverity null; the
 * severity filter naturally excludes them since they have no top severity.
 */
import { getAnalysis, listAgents, listCalls } from '../../services/db'
import { toCallListItem } from '../../utils/rollup'
import { SeveritySchema } from '#shared/types'
import type { Analysis, CallListItem, Severity } from '#shared/types'

export default defineEventHandler(async (event): Promise<CallListItem[]> => {
  const query = getQuery(event)
  const agentId = typeof query.agentId === 'string' && query.agentId ? query.agentId : undefined
  const outcome = typeof query.outcome === 'string' && query.outcome ? query.outcome : undefined

  let severity: Severity | undefined
  if (typeof query.severity === 'string' && query.severity) {
    const parsed = SeveritySchema.safeParse(query.severity)
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid severity "${query.severity}" (expected low|medium|high)`
      })
    }
    severity = parsed.data
  }

  const [calls, agents] = await Promise.all([
    listCalls(agentId ? { agentId } : undefined),
    listAgents()
  ])

  const agentNameById = new Map(agents.map(a => [a.id, a.name]))
  const analyses = await Promise.all(calls.map(c => getAnalysis(c.id)))
  const analysisByCallId = new Map<string, Analysis>()
  for (const a of analyses) {
    if (a) analysisByCallId.set(a.callId, a)
  }

  let items = calls.map(call =>
    toCallListItem(call, agentNameById.get(call.agentId) ?? 'Unknown agent', analysisByCallId.get(call.id) ?? null)
  )

  if (severity) {
    items = items.filter(item => item.topSeverity === severity)
  }
  if (outcome) {
    const wanted = outcome.toLowerCase()
    items = items.filter(item => (item.call.outcome ?? '').toLowerCase() === wanted)
  }

  return items
})
