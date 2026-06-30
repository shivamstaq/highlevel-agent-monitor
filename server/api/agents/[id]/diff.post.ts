/**
 * POST /api/agents/:id/diff -> PatchPreview + git-style hunks
 *
 * Read-only (write-back flywheel, Phase 2). Given a recommendation's
 * `applyPatch`, resolve the agent's CURRENT source (node prompt / agentPrompt /
 * config), apply the patch in-memory, and return the before/after + unified diff
 * the review UI renders. Never writes to GHL — that is the `apply` route (Phase 3).
 */
import { getAgent } from '../../../services/db'
import { previewPatch } from '#shared/agentSource'
import { diffLines, diffStat, type DiffHunk } from '#shared/diff'
import { RecommendationPatchSchema, type RecommendationPatch } from '#shared/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'agent id required' })

  const body = await readBody<{ applyPatch?: unknown }>(event)
  const parsed = RecommendationPatchSchema.safeParse(body?.applyPatch)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: `invalid applyPatch: ${parsed.error.message}` })
  }
  const patch: RecommendationPatch = parsed.data

  const agent = await getAgent(id)
  if (!agent) throw createError({ statusCode: 404, statusMessage: `agent ${id} not found` })

  const preview = previewPatch(agent, patch)

  // Compute hunks for text targets so the client renders without re-implementing diff.
  let hunks: DiffHunk[] = []
  let stat = { additions: 0, deletions: 0 }
  if (preview.kind === 'text') {
    hunks = diffLines(preview.before, preview.after)
    stat = diffStat(hunks)
  }

  return { preview, hunks, stat }
})
