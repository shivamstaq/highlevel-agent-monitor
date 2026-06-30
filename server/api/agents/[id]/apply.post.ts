/**
 * POST /api/agents/:id/apply — push approved change(s) to the LIVE GHL agent.
 *
 * Body: a single `{ applyPatch, editedText?, recommendationId?, callId?, title? }`
 * OR `{ items: [ ...same... ] }` for a batch. Each item is applied against FRESH
 * live state (re-GET), snapshotted for revert, written, and echo-confirmed. Batch
 * items apply sequentially so an anchor invalidated by an earlier edit surfaces as
 * a per-item conflict (409-style result) rather than a silent clobber.
 *
 * Gated: refuses to write unless a write-scoped PIT (GHL_PIT_WRITE_TOKEN) + location
 * are configured — read-only observability stays the default.
 */
import { getAgent, upsertChange } from '../../../services/db'
import { createGhlClient } from '../../../services/ghl'
import { resolveLiveTarget, writeTargetValue, resyncAfterWrite } from '../../../services/writeback'
import { applyTextPatch } from '#shared/patch'
import { RecommendationPatchSchema, ChangeEventSchema, type ChangeEvent } from '#shared/types'

interface ApplyItem { applyPatch?: unknown, editedText?: string, recommendationId?: string, callId?: string, title?: string }

function changeId(): string {
  return `chg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'agent id required' })

  const config = useRuntimeConfig()
  if (!config.ghlPitWriteToken) throw createError({ statusCode: 400, statusMessage: 'write-back disabled: set GHL_PIT_WRITE_TOKEN' })
  if (!config.ghlLocationId) throw createError({ statusCode: 400, statusMessage: 'GHL_LOCATION_ID required' })

  const body = await readBody<{ items?: ApplyItem[] } & ApplyItem>(event)
  const items: ApplyItem[] = Array.isArray(body?.items) ? body.items : [body]
  if (items.length === 0) throw createError({ statusCode: 400, statusMessage: 'no items to apply' })

  const client = createGhlClient({ apiBase: config.ghlApiBase, pitToken: config.ghlPitWriteToken, locationId: config.ghlLocationId })
  const stored = await getAgent(id)
  const agentName = stored?.ghl.agentName

  const results: Array<{ ok: boolean, echoConfirmed?: boolean, change?: ChangeEvent, error?: string, conflict?: boolean }> = []
  let wrote = false

  for (const item of items) {
    const parsed = RecommendationPatchSchema.safeParse(item?.applyPatch)
    if (!parsed.success) {
      results.push({ ok: false, error: 'invalid applyPatch' })
      continue
    }
    const patch = parsed.data
    try {
      const liveAgent = await client.getAgent(id)
      const resolved = await resolveLiveTarget(client, liveAgent, patch)

      // Compute the new value to write.
      let after: string
      const edited = typeof item.editedText === 'string' && item.editedText.length > 0
      if (patch.target === 'agent_config') {
        after = JSON.stringify(patch.newValue)
      } else if (edited) {
        after = item.editedText as string
      } else {
        const applied = applyTextPatch(resolved.before, patch.patch)
        if (!applied.ok) {
          results.push({ ok: false, conflict: true, error: `patch no longer applies to live text: ${applied.error}` })
          continue
        }
        after = applied.result
      }

      const { echoConfirmed } = await writeTargetValue(client, id, resolved, after)
      wrote = true

      const change: ChangeEvent = ChangeEventSchema.parse({
        id: changeId(), agentId: id, agentName,
        recommendationId: item.recommendationId, callId: item.callId,
        target: patch.target, label: resolved.label, title: item.title,
        field: resolved.field, nodeId: resolved.nodeId, versionId: resolved.versionId,
        before: resolved.before, after, edited, status: 'applied', appliedAt: new Date().toISOString()
      })
      await upsertChange(change)
      results.push({ ok: true, echoConfirmed, change })
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (wrote) await resyncAfterWrite(client, id, new Date().toISOString())
  return { results }
})
