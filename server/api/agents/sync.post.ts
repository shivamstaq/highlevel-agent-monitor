// BORROWED (mirrors GHL)
/**
 * POST /api/agents/sync — mirror Voice AI agents + their flow graphs from GHL.
 *
 * For each agent returned by `GET /voice-ai/agents` we fetch its Agent Studio
 * flow version (`llmVersionId` → `GET /agent-studio/agents/versions/:id`),
 * normalize it to a Vue-Flow FlowGraph, and persist the enriched `Agent`
 * (borrowed config + normalized flow + sync timestamp). Success-criteria
 * derivation is the eval layer's job (M3 criteria.ts); we best-effort enrich
 * when that service is present, otherwise persist with an empty set (the schema
 * defaults `successCriteria: []`) so the mirror is never blocked on the LLM.
 *
 * Body: { locationId?: string, agentIds?: string[] }. Falls back to runtimeConfig.
 * Degrades gracefully: with no PIT/location configured it returns a structured
 * error instead of throwing, so the dashboard's "Sync" button never 500s.
 */
import type { Agent } from '#shared/types'
import { createGhlClient, buildAgentFromGhl } from '../../services/ghl'
import { upsertAgent } from '../../services/db'

interface Body {
  locationId?: string
  agentIds?: string[]
}

interface SyncedAgentResult {
  agentId: string
  agentName: string
  flowNodes: number
  flowEdges: number
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const body = await readBody<Body>(event).catch(() => ({} as Body))
  // Note: GHL's `/voice-ai/agents` endpoints are scoped by the PIT (which is
  // itself location-bound), so no locationId is passed on agent reads. `body`
  // still accepts `locationId` for API symmetry with `/api/sync`.

  if (!config.ghlPitToken) {
    return { synced: 0, agents: [] as SyncedAgentResult[], errors: ['GHL_PIT_TOKEN not set'] }
  }

  const locationId = body?.locationId || (config as Record<string, string>).ghlLocationId || ''
  const client = createGhlClient({ apiBase: config.ghlApiBase, pitToken: config.ghlPitToken, locationId })
  const errors: string[] = []
  const results: SyncedAgentResult[] = []
  const now = new Date().toISOString()

  try {
    // Either the explicit agentIds (fetched individually for full config) or the
    // full list. The list already carries full config (platform.md §5).
    const ghlAgents = body?.agentIds?.length
      ? await Promise.all(
          body.agentIds.map(id =>
            client.getAgent(id).catch((err) => {
              errors.push(`getAgent(${id}) failed: ${(err as Error).message}`)
              return null
            })
          )
        ).then(a => a.filter((x): x is NonNullable<typeof x> => x != null))
      : await client.listAgents()

    for (const ghl of ghlAgents) {
      try {
        // Shared fetch+map (also used by /api/sync's auto-sync fallback). Throws
        // loudly on a missing llmVersionId or any flow fetch/mapping failure.
        let agent: Agent = await buildAgentFromGhl(client, ghl, now)

        // Best-effort criteria enrichment from the eval layer (M3). A failure
        // (provider down / bad output) must not block the mirror, but it is NO
        // LONGER swallowed — the reason is surfaced into errors[] so a
        // provider-down criteria failure is visible in the sync response.
        agent = await enrichCriteria(agent, errors)

        const stored = await upsertAgent(agent)
        results.push({
          agentId: stored.ghl.id,
          agentName: stored.ghl.agentName,
          flowNodes: stored.flow.nodes.length,
          flowEdges: stored.flow.edges.length
        })
      } catch (err) {
        errors.push(`sync failed for agent ${ghl.id}: ${(err as Error).message}`)
      }
    }
  } catch (err) {
    errors.push((err as Error).message)
  }

  return errors.length > 0
    ? { synced: results.length, agents: results, errors }
    : { synced: results.length, agents: results }
})

/**
 * Derive success criteria via the eval layer (M3 `eval/criteria`). Dynamically
 * imported and guarded so a failure never fails the read/mirror — but the
 * failure is COLLECTED into `errors` (not swallowed) so a provider-down criteria
 * derivation is visible in the sync response rather than silently leaving the
 * agent with an empty criteria set.
 */
async function enrichCriteria(agent: Agent, errors: string[]): Promise<Agent> {
  try {
    const mod = await import('../../services/eval/criteria')
    if (mod && typeof mod.deriveSuccessCriteria === 'function') {
      const criteria = await mod.deriveSuccessCriteria(agent)
      if (Array.isArray(criteria)) return { ...agent, successCriteria: criteria }
    }
  } catch (err) {
    errors.push(`criteria derivation failed for agent ${agent.ghl.id}: ${(err as Error).message}`)
  }
  return agent
}
