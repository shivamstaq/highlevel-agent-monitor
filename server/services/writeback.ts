/**
 * CREATED — write-back flywheel apply/revert engine (server-side).
 *
 * Pushes an approved change to the LIVE GHL agent and verifies it stuck. Always
 * operates on FRESH live state (re-GET before write) so we never write stale
 * assumptions, snapshots the prior value for 1-click revert, and re-mirrors the
 * agent into our store + refreshes the inferred flow (the validation loop).
 *
 * Verified write contract (docs/captures/50, 51):
 *  - prompt / agent_config → PATCH voice-ai/agents/:id (partial body, in-place).
 *  - flow_node            → PATCH agent-studio/agents/versions/:versionId { nodes }.
 */
import type { GhlClient } from './ghl'
import { buildAgentFromGhl } from './ghl'
import type { GhlAgent } from '#shared/ghl'
import type { RecommendationPatch } from '#shared/types'
import { getAgent, upsertAgent } from './db'
import { getOrDeriveInferredFlow } from './eval/inferredFlow'

/** Where a change writes, plus the current live value (raw text, or JSON for config). */
export interface ResolvedTarget {
  target: 'prompt' | 'flow_node' | 'agent_config'
  label: string
  field?: string
  nodeId?: string
  versionId?: string
  /** current live value: raw text (prompt/node) or JSON.stringify(value) (config). */
  before: string
  /** raw flow version object (flow_node only) — mutated then PATCHed back. */
  rawVersion?: Record<string, unknown>
}

function nodesOf(rawVersion: Record<string, unknown>): Array<Record<string, unknown>> {
  const nodes = rawVersion.nodes
  return Array.isArray(nodes) ? (nodes as Array<Record<string, unknown>>) : []
}

/** Resolve a patch's write target against the LIVE agent (re-GET, no stale state). */
export async function resolveLiveTarget(
  client: GhlClient, liveAgent: GhlAgent, patch: RecommendationPatch
): Promise<ResolvedTarget> {
  if (patch.target === 'prompt') {
    return { target: 'prompt', label: 'System prompt', before: liveAgent.agentPrompt ?? '' }
  }
  if (patch.target === 'agent_config') {
    const cur = (liveAgent as unknown as Record<string, unknown>)[patch.field]
    return { target: 'agent_config', label: `Config · ${patch.field}`, field: patch.field, before: JSON.stringify(cur ?? null) }
  }
  // flow_node
  const versionId = liveAgent.llmVersionId
  if (!versionId) throw new Error('agent has no flow version (llmVersionId) to edit')
  const rawVersion = await client.getRawFlowVersion(versionId)
  const node = nodesOf(rawVersion).find(n => n.nodeId === patch.nodeId)
  if (!node) throw new Error(`flow node ${patch.nodeId} not found in live version`)
  const cfg = (node.nodeConfig ?? {}) as Record<string, unknown>
  return {
    target: 'flow_node', label: `Flow node · ${String(node.nodeDisplayName ?? patch.nodeId)}`,
    nodeId: patch.nodeId, field: patch.field, versionId,
    before: String(cfg[patch.field] ?? ''), rawVersion
  }
}

/**
 * Write `value` to the resolved target on the live agent, then re-GET to confirm
 * it persisted. `value` is raw text (prompt/node) or JSON.stringify(value) (config).
 */
export async function writeTargetValue(
  client: GhlClient, agentId: string, resolved: ResolvedTarget, value: string
): Promise<{ echoConfirmed: boolean }> {
  if (resolved.target === 'prompt') {
    await client.patchAgent(agentId, { agentPrompt: value })
    const fresh = await client.getAgent(agentId)
    return { echoConfirmed: (fresh.agentPrompt ?? '') === value }
  }
  if (resolved.target === 'agent_config') {
    const parsed: unknown = JSON.parse(value)
    await client.patchAgent(agentId, { [resolved.field!]: parsed })
    const fresh = await client.getAgent(agentId)
    const freshVal = (fresh as unknown as Record<string, unknown>)[resolved.field!]
    return { echoConfirmed: JSON.stringify(freshVal ?? null) === value }
  }
  // flow_node — mutate the one node's field in the raw version, PATCH full nodes.
  const raw = resolved.rawVersion ?? await client.getRawFlowVersion(resolved.versionId!)
  const nodes = nodesOf(raw)
  const node = nodes.find(n => n.nodeId === resolved.nodeId)
  if (!node) throw new Error(`flow node ${resolved.nodeId} vanished from live version`)
  node.nodeConfig = { ...(node.nodeConfig as Record<string, unknown> ?? {}), [resolved.field!]: value }
  await client.patchFlowVersion(resolved.versionId!, { nodes })
  const after = await client.getRawFlowVersion(resolved.versionId!)
  const afterNode = nodesOf(after).find(n => n.nodeId === resolved.nodeId)
  const afterCfg = (afterNode?.nodeConfig ?? {}) as Record<string, unknown>
  return { echoConfirmed: String(afterCfg[resolved.field!] ?? '') === value }
}

/**
 * Re-mirror the agent from GHL into our store (so the dashboard reflects the new
 * text) and refresh the inferred intended flow (specHash changes → re-derive).
 * Best-effort: a re-sync/inference failure must not fail an already-successful write.
 */
export async function resyncAfterWrite(client: GhlClient, agentId: string, syncedAt: string): Promise<void> {
  try {
    const fresh = await client.getAgent(agentId)
    const rebuilt = await buildAgentFromGhl(client, fresh, syncedAt)
    const existing = await getAgent(agentId)
    const merged = existing
      ? { ...existing, ghl: rebuilt.ghl, flow: rebuilt.flow, syncedAt }
      : rebuilt
    const saved = await upsertAgent(merged)
    await getOrDeriveInferredFlow(saved) // re-infer intended flow on the new prompt
  } catch (err) {
    console.warn(`[writeback] post-write re-sync failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
