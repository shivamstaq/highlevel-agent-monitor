// CREATED (our eval layer)
/**
 * Expected Flow — the CREATED "should-be" DAG, in BOTH layers (redesign §4):
 *
 *   buildNormative(agent)            → the IDEAL flow compiled from the agent's
 *                                      design (the borrowed FlowGraph + the goal
 *                                      structure implied by the prompt/script).
 *   buildPerCall(agent, transcript)  → that normative flow REFINED to what THIS
 *                                      caller's intent should have traversed
 *                                      (e.g. an actions step only appears when the
 *                                      caller supplied data worth persisting).
 *
 * Both return the SAME `FlowGraph` shape as the borrowed Call-Flow graph so all
 * three DAGs render through one `<FlowCanvas>`. The normative graph is anchored
 * on the real flow nodes (`docs/captures/40-flow-version.json`); where the real
 * graph is sparse (a single end-capable llm node with no explicit endCall) we
 * MODEL the missing ideal spine (greet → intent → … → close) so reviewers have a
 * meaningful expectation to score against. Modeled nodes carry an `(ideal)` marker
 * in their displayName and a synthetic id prefix so provenance stays legible.
 */
import type { Agent, FlowGraph, FlowNode, FlowEdge, Transcript, TranscriptEntry } from '#shared/types'
import { FlowGraphSchema } from '#shared/types'

/** Prefix for nodes/edges we synthesize (not present in the borrowed graph). */
const IDEAL = 'ideal:'

/* ============================================================================
 * Layer A — normative (compiled from the agent design)
 * ========================================================================== */

/**
 * Compile the agent's design into the ideal DAG.
 *
 * Strategy: keep the real flow nodes/edges as the backbone (they ARE the
 * operator's intent), then guarantee the canonical conversational spine exists —
 * a Start trigger, the core LLM step, a terminal endCall — synthesizing only the
 * pieces the real graph omits. The result is a connected, start→end DAG.
 */
export function buildNormative(agent: Agent): FlowGraph {
  const base = agent.flow
  const nodes: FlowNode[] = base.nodes.map(n => ({ ...n, data: { ...n.data } }))
  const edges: FlowEdge[] = base.edges.map(e => ({ ...e }))

  const byId = new Map(nodes.map(n => [n.id, n]))
  const hasType = (t: FlowNode['type']): boolean => nodes.some(n => n.type === t)

  // 1. Ensure a single START. Prefer a real trigger node; else synthesize one.
  let start = nodes.find(n => n.data.isStart) ?? nodes.find(n => n.type === 'trigger')
  if (!start) {
    start = synthNode('start', 'trigger', 'Start Call', { isStart: true })
    nodes.unshift(start)
    byId.set(start.id, start)
  } else {
    start.data.isStart = true
  }

  // 2. Ensure a core LLM/conversation node exists (the agent's brain).
  let core = nodes.find(n => n.type === 'llm')
  if (!core) {
    core = synthNode('agent', 'llm', 'AI Agent', {
      prompt: firstSentence(agent.ghl.agentPrompt)
    })
    nodes.push(core)
    byId.set(core.id, core)
    edges.push(synthEdge(start.id, core.id, 'Begin conversation'))
  } else if (!base.edges.some(e => e.source === start!.id)) {
    // Real graph had no edge from start → core (the capture's start node is
    // detached); wire the ideal entry transition.
    edges.push(synthEdge(start.id, core.id, 'Begin conversation'))
  }

  // 3. Ensure a terminal endCall. The captured llm node is `isEnd` and the real
  //    transcript fires an `end_call` action with no dedicated node — model it so
  //    the expected flow has an explicit, scoreable close.
  if (!hasType('endCall')) {
    const end = synthNode('end_call', 'endCall', 'End Call', { isEnd: true })
    nodes.push(end)
    byId.set(end.id, end)
    // The close is reached from the core node (and from any action node, which
    // returns to the core before ending).
    edges.push(synthEdge(core.id, end.id, 'Wrap up & end call', 'end_call'))
    // The previously-terminal nodes are no longer the end.
    for (const n of nodes) {
      if (n.id !== end.id && n.type !== 'trigger') n.data.isEnd = false
    }
    end.data.isEnd = true
  }

  // 4. Re-home any real node that is start-detached so the DAG stays connected
  //    (router/action nodes in the capture branch off the core llm node).
  for (const n of nodes) {
    if (n.id === start.id) continue
    const hasIncoming = edges.some(e => e.target === n.id)
    if (!hasIncoming && n.type !== 'endCall' && core && n.id !== core.id) {
      edges.push(synthEdge(core.id, n.id, transitionLabel(n)))
    }
  }

  return FlowGraphSchema.parse({
    versionId: base.versionId,
    agentId: agent.ghl.id,
    isPublished: base.isPublished,
    nodes: sortNodes(nodes),
    edges: dedupeEdges(edges),
    viewport: base.viewport,
    globalVariables: base.globalVariables
  })
}

/* ============================================================================
 * Layer B — per-call (refine the normative flow to this caller's intent)
 * ========================================================================== */

/**
 * Refine the normative DAG to what THIS call's caller intent should have
 * traversed. Deterministic, grounded in the real transcript:
 *  - The greet→core→close spine is always expected.
 *  - A router branch is expected only if the caller asked something off-goal
 *    (a transfer/other-intent signal in their turns).
 *  - An action (e.g. updateContactField) branch is expected only if the caller
 *    actually supplied capturable data (name / phone / email / insurance).
 * Nodes the caller's intent makes irrelevant are pruned, yielding the ideal path
 * for this specific conversation.
 */
export function buildPerCall(agent: Agent, transcript: Transcript): FlowGraph {
  const normative = buildNormative(agent)
  const signals = detectIntentSignals(transcript)

  const keep = (n: FlowNode): boolean => {
    if (n.type === 'router') return signals.offGoalIntent
    if (n.type === 'action') return signals.suppliedData
    return true // trigger / llm / endCall always expected
  }

  const keptNodes = normative.nodes.filter(keep)
  const keptIds = new Set(keptNodes.map(n => n.id))
  const edges = normative.edges.filter(e => keptIds.has(e.source) && keptIds.has(e.target))

  // Reconnect: if pruning a branch orphaned the close, ensure core→endCall holds.
  const core = keptNodes.find(n => n.type === 'llm')
  const end = keptNodes.find(n => n.type === 'endCall')
  if (core && end && !edges.some(e => e.source === core.id && e.target === end.id)) {
    edges.push(synthEdge(core.id, end.id, 'Wrap up & end call', 'end_call'))
  }

  return FlowGraphSchema.parse({
    versionId: normative.versionId,
    agentId: normative.agentId,
    isPublished: normative.isPublished,
    nodes: keptNodes,
    edges: dedupeEdges(edges),
    viewport: normative.viewport,
    globalVariables: normative.globalVariables
  })
}

interface IntentSignals {
  /** Caller asked for something outside the agent's primary goal (→ router). */
  offGoalIntent: boolean
  /** Caller supplied persistable data (→ action/updateContactField). */
  suppliedData: boolean
}

function detectIntentSignals(transcript: Transcript): IntentSignals {
  const customer = transcript.entries
    .filter((e): e is Extract<TranscriptEntry, { role: 'customer' }> => e.role === 'customer')
    .map(e => e.content.toLowerCase())
    .join(' ')

  const offGoalIntent
    = /(transfer|speak to|human|someone else|manager|representative|interview|complaint|different|something else)/.test(
      customer
    )
  const suppliedData
    = /(my name is|i'?m\s+[a-z]+|number is|phone|insurance|email|@|\bzero|\bone\b|\btwo\b|\d{3})/.test(
      customer
    )

  return { offGoalIntent, suppliedData }
}

/* ============================================================================
 * Node/edge synthesis + graph hygiene
 * ========================================================================== */

function synthNode(
  localId: string,
  type: FlowNode['type'],
  displayName: string,
  extra: Partial<FlowNode['data']> = {}
): FlowNode {
  return {
    id: `${IDEAL}${localId}`,
    type,
    position: { x: 0, y: 0 }, // layout is assigned by the UI; ideal nodes need no real geometry
    data: {
      displayName: `${displayName} (ideal)`,
      isStart: false,
      isEnd: false,
      ...extra
    }
  }
}

function synthEdge(source: string, target: string, label: string, toolName?: string): FlowEdge {
  return {
    id: `${IDEAL}${source}->${target}`,
    source,
    target,
    label,
    condition: toolName ? `tool_name EQ ${toolName}` : undefined
  }
}

function transitionLabel(n: FlowNode): string {
  if (n.type === 'router') return 'Route on caller intent'
  if (n.type === 'action') return `Call ${stripIdeal(n.data.displayName)}`
  if (n.type === 'endCall') return 'End call'
  return `To ${stripIdeal(n.data.displayName)}`
}

function stripIdeal(s: string): string {
  return s.replace(/\s*\(ideal\)\s*$/, '')
}

/** trigger first, endCall last, real (non-ideal) nodes before synthesized ones. */
function sortNodes(nodes: FlowNode[]): FlowNode[] {
  const rank: Record<FlowNode['type'], number> = {
    trigger: 0,
    llm: 1,
    router: 2,
    action: 3,
    endCall: 4
  }
  return [...nodes].sort((a, b) => {
    if (rank[a.type] !== rank[b.type]) return rank[a.type] - rank[b.type]
    const ai = a.id.startsWith(IDEAL) ? 1 : 0
    const bi = b.id.startsWith(IDEAL) ? 1 : 0
    return ai - bi
  })
}

function dedupeEdges(edges: FlowEdge[]): FlowEdge[] {
  const seen = new Set<string>()
  const out: FlowEdge[] = []
  for (const e of edges) {
    const key = `${e.source}->${e.target}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

function firstSentence(s: string): string {
  const t = s.trim().split(/(?<=[.!?])\s/)[0] ?? s
  return t.length > 200 ? `${t.slice(0, 199)}…` : t
}
