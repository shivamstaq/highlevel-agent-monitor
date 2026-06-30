/**
 * POST /api/agents/:id/revert — undo an applied change by writing its snapshot
 * (`before`) back to the live agent. Marks the ChangeEvent reverted and re-mirrors.
 */
import { getAgent, getChange, upsertChange } from '../../../services/db'
import { createGhlClient } from '../../../services/ghl'
import { writeTargetValue, resyncAfterWrite, type ResolvedTarget } from '../../../services/writeback'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'agent id required' })

  const config = useRuntimeConfig()
  if (!config.ghlPitWriteToken) throw createError({ statusCode: 400, statusMessage: 'write-back disabled: set GHL_PIT_WRITE_TOKEN' })

  const { changeId } = await readBody<{ changeId?: string }>(event)
  if (!changeId) throw createError({ statusCode: 400, statusMessage: 'changeId required' })

  const change = await getChange(changeId)
  if (!change || change.agentId !== id) throw createError({ statusCode: 404, statusMessage: 'change not found for this agent' })
  if (change.status === 'reverted') throw createError({ statusCode: 409, statusMessage: 'change already reverted' })

  const client = createGhlClient({ apiBase: config.ghlApiBase, pitToken: config.ghlPitWriteToken, locationId: config.ghlLocationId })
  await getAgent(id) // existence not strictly required; live write is authoritative

  // Reconstruct the write target from the recorded change and write `before` back.
  const resolved: ResolvedTarget = {
    target: change.target, label: change.label,
    field: change.field, nodeId: change.nodeId, versionId: change.versionId,
    before: change.after // current live value should be `after`; informational only
  }
  const { echoConfirmed } = await writeTargetValue(client, id, resolved, change.before)

  const reverted = { ...change, status: 'reverted' as const, revertedAt: new Date().toISOString() }
  await upsertChange(reverted)
  await resyncAfterWrite(client, id, new Date().toISOString())

  return { ok: true, echoConfirmed, change: reverted }
})
