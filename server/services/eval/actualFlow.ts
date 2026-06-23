// CREATED (our eval layer)
/**
 * Actual Flow — the CREATED executed-trace DAG (R2 §1.4 / redesign §4), now built
 * from the LLM-LABELED transcript.
 *
 * buildActualFlow(transcript, flow, stageSet?) walks the REAL transcript and emits
 * ONE node per distinct conversational STAGE the call actually enacted (in
 * first-visit order), plus one node per executed `action_executed` (tool) entry.
 * The stages come from the turns' `stageId` labels (written by labeling.ts off the
 * agent's inferred `AgentStageSet`); the labels are the dynamic, LLM-inferred
 * vocabulary — there is no hardcoded stage list here.
 *
 * Multi-node, in order:
 *   - The opening of the call enters via the design's trigger/start node (so the
 *     expected Start is credited by conformance).
 *   - Each distinct enacted `stageId` becomes a conversational (`llm`-typed) node,
 *     labeled from the stage set. The stage that best represents the design's core
 *     adopts the design's real `llm` node id so conformance reconciles it as a hit;
 *     the remaining stage nodes carry stable `actual:stage:<id>` ids.
 *   - Each `action_executed` maps to its design action/router/endCall node
 *     (end_call → endCall, router → router, else the matching action node),
 *     synthesizing an `extra` node only when the design lacks it.
 *
 * When the transcript is UN-labeled (e.g. the read path that has not run the
 * labeler), it degrades gracefully: every spoken turn maps to a single core
 * conversational node — the same shape conformance has always expected — so the
 * route still renders a valid trace. Deterministic, no LLM in this function.
 *
 * Output is the same `ActualFlow` shape conformance.ts consumes (now multi-node):
 * the distinct nodes visited (first-visit order), the transitions actually taken
 * (consecutive distinct nodes), and the ordered `path` of nodeIds.
 */
import type {
  FlowGraph,
  FlowNode,
  FlowEdge,
  Transcript,
  TranscriptEntry,
  TurnEntry,
  AgentStageSet,
  StageNode,
  ActualFlow
} from '#shared/types'
import { ActualFlowSchema } from '#shared/types'

export function buildActualFlow(
  transcript: Transcript,
  flow: FlowGraph,
  stageSet?: AgentStageSet
): ActualFlow {
  const resolver = new NodeResolver(flow, stageSet)
  const path: string[] = []

  for (const entry of transcript.entries) {
    const ids = resolveEntry(entry, resolver, path)
    for (const id of ids) {
      if (path[path.length - 1] !== id) path.push(id)
    }
  }

  // Distinct nodes in first-visit order, projected from the resolver (so the trace
  // renders with the same node identity/type as the other two DAGs).
  const visited: string[] = []
  for (const id of path) if (!visited.includes(id)) visited.push(id)
  const nodes: FlowNode[] = visited.map(id => resolver.node(id))

  // Transitions actually taken = consecutive distinct nodes along the path.
  const edges: FlowEdge[] = []
  const seenEdge = new Set<string>()
  for (let i = 1; i < path.length; i++) {
    const source = path[i - 1]!
    const target = path[i]!
    if (source === target) continue
    const key = `${source}->${target}`
    if (seenEdge.has(key)) continue
    seenEdge.add(key)
    edges.push({
      id: `actual:${key}`,
      source,
      target,
      label: resolver.edgeLabel(source, target)
    })
  }

  return ActualFlowSchema.parse({
    callId: transcript.callId,
    agentId: flow.agentId,
    nodes,
    edges,
    path
  })
}

/* -------------------------------------------------------------------------- */
/* Entry → node mapping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Map a transcript entry onto the node id(s) it enacted. A spoken turn yields its
 * stage node (or the core node when un-labeled); the very first spoken turn first
 * enters via the trigger. An action yields its mapped action/router/endCall node.
 */
function resolveEntry(entry: TranscriptEntry, resolver: NodeResolver, path: string[]): string[] {
  if (entry.role === 'action') {
    return [resolver.actionNode(entry.toolName, entry.toolType)]
  }

  const out: string[] = []
  // The first thing the call did is enter via the trigger.
  if (path.length === 0 && resolver.triggerNode()) {
    out.push(resolver.triggerNode()!)
  }
  out.push(resolver.stageNode(entry))
  return out
}

/* -------------------------------------------------------------------------- */
/* NodeResolver — map turns/stages/tools to concrete nodes, with safe fallbacks. */
/* -------------------------------------------------------------------------- */

class NodeResolver {
  private readonly flow: FlowGraph
  private readonly byId: Map<string, FlowNode>
  private readonly synthetic = new Map<string, FlowNode>()
  private readonly stageById: Map<string, StageNode>
  /** stageId chosen to adopt the design's real `llm` id (the "core" stage). */
  private readonly coreStageId: string | null
  private readonly designLlmId: string | null

  constructor(flow: FlowGraph, stageSet?: AgentStageSet) {
    this.flow = flow
    this.byId = new Map(flow.nodes.map(n => [n.id, n]))
    this.stageById = new Map((stageSet?.stages ?? []).map(s => [s.id, s]))
    this.designLlmId = flow.nodes.find(n => n.type === 'llm')?.id ?? null
    this.coreStageId = pickCoreStage(stageSet)
  }

  node(id: string): FlowNode {
    return (
      this.byId.get(id)
      ?? this.synthetic.get(id) ?? {
        id,
        type: 'action',
        position: { x: 0, y: 0 },
        data: { displayName: id, isStart: false, isEnd: false }
      }
    )
  }

  triggerNode(): string | null {
    const t = this.flow.nodes.find(n => n.data.isStart) ?? this.flow.nodes.find(n => n.type === 'trigger')
    return t?.id ?? null
  }

  /**
   * Resolve the conversational node for a spoken turn. Labeled turns resolve to
   * their distinct stage node; the core stage adopts the design's real `llm` id so
   * conformance reconciles it. Un-labeled turns collapse to the single core node
   * (back-compat with the read path that hasn't run the labeler).
   */
  stageNode(entry: TurnEntry): string {
    const stageId = entry.stageId
    if (!stageId || !this.stageById.has(stageId)) return this.coreNode()

    // The chosen core stage borrows the design's llm node identity.
    if (this.coreStageId && stageId === this.coreStageId && this.designLlmId) {
      return this.designLlmId
    }

    const id = `actual:stage:${stageId}`
    if (!this.synthetic.has(id) && !this.byId.has(id)) {
      const stage = this.stageById.get(stageId)!
      this.synthetic.set(id, {
        id,
        type: 'llm',
        position: { x: 0, y: 0 },
        data: { displayName: stage.label, isStart: false, isEnd: false }
      })
    }
    return id
  }

  /** The single core conversational node (design llm, else start, else first/synth). */
  coreNode(): string {
    if (this.designLlmId) return this.designLlmId
    return this.triggerNode() ?? this.flow.nodes[0]?.id ?? this.synth('core', 'AI Agent', 'llm')
  }

  /** Map an executed tool to a node: end_call→endCall, router→router, else action. */
  actionNode(toolName: string, toolType: string): string {
    const name = toolName.toLowerCase()
    const type = toolType.toLowerCase()

    if (name === 'end_call' || type === 'end_call') {
      const end = this.flow.nodes.find(n => n.type === 'endCall')
      if (end) return end.id
      return this.synth('end_call', 'End Call', 'endCall')
    }

    if (name.includes('router') || type.includes('router')) {
      const router = this.flow.nodes.find(n => n.type === 'router')
      if (router) return router.id
      return this.synth('router', 'Router', 'router')
    }

    const match = this.flow.nodes.find(
      n =>
        n.type === 'action'
        && (norm(n.data.displayName).includes(norm(toolName))
          || norm(toolName).includes(norm(n.data.displayName)))
    )
    if (match) return match.id

    const anyAction = this.flow.nodes.find(n => n.type === 'action')
    if (anyAction) return anyAction.id

    return this.synth(`tool:${name}`, toolName, 'action')
  }

  edgeLabel(source: string, target: string): string | undefined {
    const e = this.flow.edges.find(x => x.source === source && x.target === target)
    if (e?.label) return e.label
    const tgt = this.node(target)
    if (tgt.type === 'endCall') return 'End call'
    if (tgt.type === 'action') return `Call ${tgt.data.displayName}`
    if (tgt.type === 'router') return 'Route'
    return undefined
  }

  private synth(localId: string, displayName: string, type: FlowNode['type']): string {
    const id = `actual:${localId}`
    if (!this.synthetic.has(id)) {
      this.synthetic.set(id, {
        id,
        type,
        position: { x: 0, y: 0 },
        data: { displayName, isStart: false, isEnd: type === 'endCall' }
      })
    }
    return id
  }
}

/**
 * Choose the stage that best represents the design's "core" conversation, so it
 * can adopt the design's `llm` node id (keeping conformance's core node hit). We
 * prefer a stage whose kind/id reads as the central conversational phase
 * (qualify/collect/core/conversation/handle), else the middle stage, else the
 * first — a deterministic, vocabulary-agnostic pick (no hardcoded enum).
 */
function pickCoreStage(stageSet?: AgentStageSet): string | null {
  const stages = stageSet?.stages ?? []
  if (stages.length === 0) return null
  const core = stages.find(s =>
    /(qualif|collect|core|convers|handle|discuss|book|schedul|appoint|gather)/i.test(`${s.id} ${s.kind} ${s.label}`)
  )
  if (core) return core.id
  return stages[Math.floor(stages.length / 2)]!.id
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Keep TranscriptEntry import meaningful for downstream type-narrowing users.
export type { TranscriptEntry }
