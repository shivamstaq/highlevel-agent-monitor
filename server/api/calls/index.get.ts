/**
 * GET /api/calls -> CallListItem[]
 *
 * Filterable call list. Query params:
 *   - agentId:  only calls for this agent
 *   - severity: only calls whose top finding severity equals this (low|medium|high)
 *   - callType: only calls of this type (LIVE|TRIAL — from GHL `trialCall`)
 *
 * Calls without an analysis yet are surfaced with score/topSeverity null; the
 * severity filter naturally excludes them since they have no top severity.
 *
 * HOT READ PATH: reads ONLY the write-time index records via getItem
 * (`index:calls`, `index:agents`, `index:fleet`) — ZERO getKeys / list / getAnalysis.
 * Each list item is built from the compact AnalysisSummary in `index:fleet`, which
 * carries every field the item surfaces (overall, finding severities,
 * conformanceScore). Filtering and newest-first sort run in memory over the index
 * values. On an empty KV every getter returns its empty map without listing.
 */
import { getAgentsIndex, getCallsIndex, getFleetIndex } from '../../services/db'
import { toCallListItemFromSummary } from '../../utils/rollup'
import { SeveritySchema, CallTypeSchema } from '#shared/types'
import type { CallListItem, CallType, Severity } from '#shared/types'

export default defineEventHandler(async (event): Promise<CallListItem[]> => {
  const query = getQuery(event)
  const agentId = typeof query.agentId === 'string' && query.agentId ? query.agentId : undefined

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

  let callType: CallType | undefined
  if (typeof query.callType === 'string' && query.callType) {
    const parsed = CallTypeSchema.safeParse(query.callType)
    if (!parsed.success) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid callType "${query.callType}" (expected LIVE|TRIAL)`
      })
    }
    callType = parsed.data
  }

  const [callsIndex, agentsIndex, fleetIndex] = await Promise.all([
    getCallsIndex(),
    getAgentsIndex(),
    getFleetIndex()
  ])

  const agentNameById = new Map(
    Object.values(agentsIndex.agents).map(a => [a.ghl.id, a.ghl.agentName])
  )
  const summaries = fleetIndex?.summaries ?? {}

  // Newest-first (matches the previous listCalls sort). Agent filter applied here
  // in memory over the index values — no getKeys.
  let calls = Object.values(callsIndex.calls)
  if (agentId) calls = calls.filter(c => c.agentId === agentId)
  calls.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  let items = calls.map(call =>
    toCallListItemFromSummary(
      call,
      agentNameById.get(call.agentId) ?? 'Unknown agent',
      summaries[call.id] ?? null
    )
  )

  if (severity) {
    items = items.filter(item => item.topSeverity === severity)
  }
  if (callType) {
    items = items.filter(item => item.call.callType === callType)
  }

  return items
})
