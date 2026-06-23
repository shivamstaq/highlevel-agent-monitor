/**
 * GET /api/agents -> FleetStats
 *
 * Fleet-wide health rollup: aggregate every analyzed call into the headline KPIs,
 * the per-day trend, per-agent health, and the top fleet recommendations.
 *
 * HOT READ PATH: reads ONLY the three write-time index records via getItem
 * (`index:agents`, `index:calls`, `index:fleet`) — ZERO getKeys/list*. On a fresh
 * (empty) KV every index getter returns its empty map without listing, so this
 * returns the zeroed FleetStats and never 500s.
 */
import { getAgentsIndex, getCallsIndex, getFleetIndex } from '../../services/db'
import { computeFleetStatsFromIndexes, FLEET_INDEX_VERSION } from '../../utils/rollup'
import type { FleetStats } from '#shared/types'

export default defineEventHandler(async (): Promise<FleetStats> => {
  const [agentsIndex, callsIndex, fleetIndex] = await Promise.all([
    getAgentsIndex(),
    getCallsIndex(),
    getFleetIndex()
  ])

  // getFleetIndex returns null on a miss; the empty fleet index is { summaries: {} }.
  const fleet = fleetIndex ?? { version: FLEET_INDEX_VERSION, summaries: {} }
  return computeFleetStatsFromIndexes(agentsIndex, callsIndex, fleet)
})
