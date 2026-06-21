/**
 * GET /api/agents -> FleetStats
 *
 * Fleet-wide health rollup: aggregate every stored analysis into the headline
 * KPIs, the per-day trend, per-agent health, and the top fleet recommendations.
 * Tolerates empty storage (returns zeroed metrics and empty arrays).
 */
import { listAgents, listAnalyses, listCalls } from '../../services/db'
import { computeFleetStats } from '../../utils/rollup'
import type { FleetStats } from '#shared/types'

export default defineEventHandler(async (): Promise<FleetStats> => {
  const [agents, calls, analyses] = await Promise.all([
    listAgents(),
    listCalls(),
    listAnalyses()
  ])

  return computeFleetStats(agents, calls, analyses)
})
