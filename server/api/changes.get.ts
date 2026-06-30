/**
 * GET /api/changes -> ChangeEvent[]
 *
 * Write-back audit log: every change pushed to a live agent (applied/reverted),
 * newest first. Optional `?agentId=` scopes to one agent. Drives the Changes page
 * history and the per-card "Applied / Revert" state.
 */
import { listChanges } from '../services/db'
import type { ChangeEvent } from '#shared/types'

export default defineEventHandler(async (event): Promise<ChangeEvent[]> => {
  const q = getQuery(event)
  const agentId = typeof q.agentId === 'string' && q.agentId ? q.agentId : undefined
  return listChanges(agentId)
})
