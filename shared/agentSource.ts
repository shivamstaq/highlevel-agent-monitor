/**
 * CREATED — write-back flywheel: where an agent's REAL instructions live, and
 * how a `RecommendationPatch` maps onto the agent's current text/config.
 *
 * Shape rule (verified live, docs/captures/51):
 *  - node-flow agents (Agent Studio): instructions live in each flow node's
 *    `data.prompt`. The top-level `agentPrompt` is a STALE leftover — ignore it.
 *  - prompt-only agents: the single top-level `agentPrompt` string.
 * Analysis input AND the write target both follow this resolution, so the model
 * reasons over — and patches — the text that actually drives the agent.
 */
import type { Agent, RecommendationPatch } from './types'
import { applyTextPatch } from './patch'

export type WritableSource
  = | { kind: 'prompt', text: string }
    | { kind: 'flow', nodes: Array<{ nodeId: string, label: string, text: string }> }

export function resolveWritableSource(agent: Agent): WritableSource {
  const flowNodes = (agent.flow?.nodes ?? [])
    .filter(n => typeof n.data?.prompt === 'string' && n.data.prompt!.trim().length > 0)
    .map(n => ({ nodeId: n.id, label: n.data.displayName || n.id, text: n.data.prompt as string }))
  if (flowNodes.length > 0) return { kind: 'flow', nodes: flowNodes }
  return { kind: 'prompt', text: agent.ghl.agentPrompt ?? '' }
}

/** Top-level GHL config fields a recommendation may target via `agent_config`. */
export const WRITABLE_CONFIG_FIELDS = [
  'welcomeMessage', 'voiceId', 'language', 'responsiveness', 'maxCallDuration',
  'sendUserIdleReminders', 'reminderAfterIdleTimeSeconds', 'toolCallStrictMode', 'timezone'
] as const

export function currentConfigValue(agent: Agent, field: string): unknown {
  return (agent.ghl as unknown as Record<string, unknown>)[field]
}

/**
 * Resolve a patch against the agent's CURRENT state into a reviewable shape:
 *  - text targets (prompt | flow_node) → `before`/`after` for a diff.
 *  - config targets → `field`/`oldValue`/`newValue` rows.
 * `applicable:false` + `error` when the patch can't cleanly apply (anchor drift /
 * unknown node / config oldValue mismatch) — the operator falls back to manual.
 */
export type PatchPreview
  = | { kind: 'text', target: 'prompt' | 'flow_node', label: string, nodeId?: string, field?: string, before: string, after: string, applicable: true }
    | { kind: 'config', target: 'agent_config', label: string, field: string, oldValue: unknown, newValue: unknown, applicable: boolean, error?: string }
    | { kind: 'error', target: RecommendationPatch['target'], label: string, applicable: false, error: string }

export function previewPatch(agent: Agent, patch: RecommendationPatch): PatchPreview {
  if (patch.target === 'agent_config') {
    const cur = currentConfigValue(agent, patch.field)
    const matches = JSON.stringify(cur) === JSON.stringify(patch.oldValue)
    return {
      kind: 'config', target: 'agent_config', label: `Config · ${patch.field}`,
      field: patch.field, oldValue: patch.oldValue, newValue: patch.newValue,
      applicable: matches,
      ...(matches ? {} : { error: `current value of ${patch.field} no longer matches oldValue` })
    }
  }
  const src = resolveWritableSource(agent)
  let before: string
  let label: string
  let nodeId: string | undefined
  if (patch.target === 'prompt') {
    if (src.kind !== 'prompt') return { kind: 'error', target: 'prompt', label: 'System prompt', applicable: false, error: 'agent is node-flow; prompt target invalid' }
    before = src.text
    label = 'System prompt'
  } else {
    if (src.kind !== 'flow') return { kind: 'error', target: 'flow_node', label: 'Flow node', applicable: false, error: 'agent is prompt-only; flow_node target invalid' }
    const node = src.nodes.find(n => n.nodeId === patch.nodeId)
    if (!node) return { kind: 'error', target: 'flow_node', label: 'Flow node', applicable: false, error: `unknown node ${patch.nodeId}` }
    before = node.text
    label = `Flow node · ${node.label}`
    nodeId = node.nodeId
  }
  const applied = applyTextPatch(before, patch.patch)
  if (!applied.ok) {
    return { kind: 'error', target: patch.target, label, applicable: false, error: applied.error }
  }
  return {
    kind: 'text', target: patch.target, label, before, after: applied.result, applicable: true,
    ...(nodeId ? { nodeId, field: patch.target === 'flow_node' ? patch.field : undefined } : {})
  }
}
