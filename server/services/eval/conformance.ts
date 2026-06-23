// CREATED (our eval layer)
/**
 * Flow Conformance — deterministic alignment of the ActualFlow trace against the
 * ExpectedFlow DAG (redesign §4). NO LLM: pure graph/process-mining alignment.
 *
 * For every expected node we decide one of:
 *   hit          — the node was traversed by the call.
 *   skipped      — a MANDATORY (spine) expected node the call never reached.
 *   out_of_order — traversed, but not in the expected topological position.
 *   extra        — (attached to actual-only nodes) the call did something the
 *                  expected flow didn't anticipate (drift).
 *
 * Conformance P (conservative): an OPTIONAL branch node (router/action) that the
 * per-call heuristic *speculatively* expected but that did not fire is treated as
 * `not_applicable` — we are not confident it should have run for this caller, so
 * we DROP it from the alignment readout and from scoring rather than recording a
 * hard `skipped` failure that over-penalizes the call. (`NodeStatus` has no
 * `not_applicable` member, and this layer must not widen the shared schema, so the
 * conservative outcome is realized as an OMISSION — the honest neutral within the
 * closed enum.) Mandatory spine nodes (trigger/llm/endCall) that go unfired remain
 * a genuine `skipped`.
 *
 * Conformance N: `nodeAlignments` are overlay/readout data for the ACTUAL trace
 * (and the conformance panel) ONLY — a pass/fail ring is NEVER painted onto the
 * EXPECTED DAG. The UI keys the overlay by these ids onto the actual graph; an
 * expected-only `skipped` id simply has no actual node to land on, so it never
 * tints the Expected canvas.
 *
 * From the per-node alignment we compute:
 *   driftScore     per node in [0,1] (0 = clean hit, 1 = max drift).
 *   conformanceScore 0–100 headline (token-replay style fitness, weighted).
 *   fitness        0–1 process-mining fitness (replayable transitions / total).
 *   driftEdges     transitions the actual trace took that the expected graph lacks.
 *
 * The alignment uses the EXPECTED graph's topological order as the reference
 * sequence and the ActualFlow.path as the observed sequence, comparing positions
 * via a longest-common-subsequence so genuine reordering (out_of_order) is
 * distinguished from omission (skipped).
 */
import type {
  ActualFlow,
  ExpectedFlow,
  FlowGraph,
  FlowNode,
  NodeAlignment,
  NodeStatus,
  DriftEdge,
  FlowConformance,
  Transcript,
  TranscriptEntry
} from '#shared/types'
import { FlowConformanceSchema } from '#shared/types'

export interface ConformanceInput {
  callId: string
  expected: ExpectedFlow
  actual: ActualFlow
  /** Used to attribute matched transcript entry idxs to each hit node. */
  transcript: Transcript
}

export function computeConformance(input: ConformanceInput): FlowConformance {
  const { callId, expected, actual, transcript } = input
  // Per-call ideal is the reference when present (it's tailored to this caller),
  // otherwise the normative flow.
  const reference: FlowGraph = expected.perCall?.ideal ?? expected.normative

  // Conformance P — when the reference is the PER-CALL ideal, the presence of an
  // optional branch node (router/action) is the deterministic heuristic's *guess*
  // that this caller's intent should traverse it. If such a speculatively-expected
  // branch did not fire, we classify it `not_applicable` (omit, don't penalize)
  // rather than `skipped`. The normative reference is the operator's full design,
  // so its optional branches are NOT speculative and a miss there stays `skipped`.
  const referenceIsPerCall = expected.perCall?.ideal != null

  const expectedNodes = reference.nodes
  const expectedOrder = topoOrder(reference)
  const expectedIndex = new Map(expectedOrder.map((id, i) => [id, i]))

  // Reconcile actual node ids onto expected ids. Ids match directly when both
  // layers share the borrowed node; where they differ (e.g. the design has no
  // explicit endCall so both layers SYNTHESIZE one with different prefixes) we
  // fall back to a unique type match for spine nodes (trigger/llm/endCall) so a
  // real clean end-call is credited to the expected close instead of being
  // double-counted as a skip + an extra.
  const reconcile = buildReconciler(reference, actual)
  const actualPath = actual.path.map(id => reconcile(id))
  const actualSet = new Set(actualPath)

  // Reference sequence (expected, ordered) vs observed (actual path, de-duped to
  // first visits) → LCS marks which hits are in-order vs out-of-order.
  const observedFirstVisit = dedupeKeepFirst(actualPath)
  const expectedSeq = expectedOrder.filter(id => expectedIndex.has(id))
  const inOrder = lcsMembership(
    expectedSeq.filter(id => actualSet.has(id)),
    observedFirstVisit.filter(id => expectedIndex.has(id))
  )

  const matchedEntryIdxs = attributeEntries(transcript, actual, reference, reconcile)

  const nodeAlignments: NodeAlignment[] = []

  // 1. Expected nodes → hit / out_of_order / skipped (or, conservatively, omitted
  //    as `not_applicable`).
  for (const node of expectedNodes) {
    const hit = actualSet.has(node.id)
    let status: NodeStatus
    let drift: number
    if (!hit) {
      // Conformance P: a speculatively-expected OPTIONAL branch (per-call heuristic
      // guessed it; the node is an optional router/action) that did not fire is
      // `not_applicable` — drop it entirely (no alignment row, no scoring weight)
      // instead of recording a hard `skipped` failure.
      if (referenceIsPerCall && isOptionalBranch(node)) continue
      status = 'skipped'
      drift = skipDrift(node)
    } else if (inOrder.has(node.id)) {
      status = 'hit'
      drift = 0
    } else {
      status = 'out_of_order'
      drift = 0.5
    }
    nodeAlignments.push({
      nodeId: node.id,
      displayName: node.data.displayName,
      status,
      driftScore: round2(drift),
      matchedEntryIdxs: matchedEntryIdxs.get(node.id) ?? []
    })
  }

  // 2. Actual-only nodes → extra (drift the design didn't anticipate). Reconciled
  //    actual nodes that mapped onto an expected node are NOT extra.
  const expectedIds = new Set(expectedNodes.map(n => n.id))
  for (const node of actual.nodes) {
    const mapped = reconcile(node.id)
    if (expectedIds.has(mapped)) continue
    nodeAlignments.push({
      nodeId: node.id,
      displayName: node.data.displayName,
      status: 'extra',
      driftScore: 0.7,
      matchedEntryIdxs: matchedEntryIdxs.get(node.id) ?? []
    })
  }

  // 3. Drift edges: transitions the actual trace took that aren't in the expected
  //    graph (compared on reconciled endpoints).
  const expectedEdgeKeys = new Set(reference.edges.map(e => `${e.source}->${e.target}`))
  const driftEdges: DriftEdge[] = []
  const seenDrift = new Set<string>()
  for (const e of actual.edges) {
    const source = reconcile(e.source)
    const target = reconcile(e.target)
    const key = `${source}->${target}`
    if (expectedEdgeKeys.has(key) || seenDrift.has(key)) continue
    seenDrift.add(key)
    driftEdges.push({
      source,
      target,
      reason: reasonForDrift(source, target, expectedIds)
    })
  }

  // 4. Fitness (process-mining): replayable actual transitions / total actual transitions.
  const totalActualTransitions = actual.edges.length
  const replayable = totalActualTransitions - driftEdges.length
  const fitness
    = totalActualTransitions === 0 ? 1 : clamp01(replayable / totalActualTransitions)

  // 5. Conformance headline 0–100: weighted node coverage minus drift penalties.
  const conformanceScore = scoreFromAlignments(nodeAlignments, expectedNodes.length)

  return FlowConformanceSchema.parse({
    callId,
    versionId: reference.versionId,
    conformanceScore: round2(conformanceScore),
    fitness: round2(fitness),
    nodeAlignments,
    driftEdges
  })
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 0–100. Each expected node contributes weight by importance; a hit earns full
 * credit, out_of_order earns half, skipped earns none. Extra nodes apply a small
 * fleet-visible penalty. Empty expected graph ⇒ 100 (nothing to violate).
 */
function scoreFromAlignments(alignments: NodeAlignment[], expectedCount: number): number {
  const expected = alignments.filter(a => a.status !== 'extra')
  if (expected.length === 0) return 100

  let earned = 0
  let possible = 0
  for (const a of expected) {
    const w = nodeWeight(a)
    possible += w
    if (a.status === 'hit') earned += w
    else if (a.status === 'out_of_order') earned += w * 0.5
  }
  let score = possible === 0 ? 100 : (earned / possible) * 100

  const extras = alignments.filter(a => a.status === 'extra').length
  score -= Math.min(15, extras * 5) // cap extra-node penalty
  void expectedCount
  return clamp(score, 0, 100)
}

/** Mandatory spine nodes (trigger/llm/endCall) weigh more than optional branches. */
function nodeWeight(a: NodeAlignment): number {
  // We only have displayName/status here; infer importance from the id markers
  // we set when building the graphs (ideal close / core), defaulting to 1.
  const id = a.nodeId.toLowerCase()
  if (id.includes('end') || id.includes('start') || id.includes('agent') || id.includes('core')) {
    return 2
  }
  return 1
}

/** Skipping an optional branch hurts less than skipping a mandatory step. */
function skipDrift(node: FlowNode): number {
  if (isOptionalBranch(node)) return 0.6
  return 1
}

/**
 * Optional branch nodes (router/action) are the speculative, intent-conditional
 * steps; trigger/llm/endCall are the mandatory conversational spine. Only optional
 * branches qualify for the conservative `not_applicable` (omit) treatment when the
 * per-call heuristic expected them but the call never fired them (Conformance P).
 */
function isOptionalBranch(node: FlowNode): boolean {
  return node.type === 'router' || node.type === 'action'
}

/* -------------------------------------------------------------------------- */
/* Graph + sequence utilities                                                 */
/* -------------------------------------------------------------------------- */

/** Kahn topological order; falls back to declared order on cycles. */
function topoOrder(g: FlowGraph): string[] {
  const indeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of g.nodes) {
    indeg.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const e of g.edges) {
    if (!indeg.has(e.target) || !adj.has(e.source)) continue
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    adj.get(e.source)!.push(e.target)
  }
  const queue = g.nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id)
  const order: string[] = []
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1)
      if ((indeg.get(next) ?? 0) <= 0 && !seen.has(next)) queue.push(next)
    }
  }
  // Append any nodes left out by a cycle, preserving declared order.
  for (const n of g.nodes) if (!seen.has(n.id)) order.push(n.id)
  return order
}

function dedupeKeepFirst(path: string[]): string[] {
  const out: string[] = []
  for (const id of path) if (!out.includes(id)) out.push(id)
  return out
}

/**
 * Returns the set of ids that lie on the longest common subsequence of the
 * expected-ordered hits and the observed-ordered hits — i.e. the nodes that were
 * visited in their expected relative order. Ids hit but off the LCS are
 * out-of-order.
 */
function lcsMembership(expected: string[], observed: string[]): Set<string> {
  const n = expected.length
  const m = observed.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i]![j]!
        = expected[i - 1] === observed[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
    }
  }
  const onLcs = new Set<string>()
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (expected[i - 1] === observed[j - 1]) {
      onLcs.add(expected[i - 1]!)
      i--
      j--
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--
    } else {
      j--
    }
  }
  return onLcs
}

/**
 * Build the actual→expected id reconciler. Direct id matches win; otherwise a
 * spine node whose TYPE is unique on both sides (trigger / llm / endCall) maps to
 * its expected counterpart. This bridges synthesized nodes that legitimately
 * represent the same step across the expected and actual layers.
 */
function buildReconciler(reference: FlowGraph, actual: ActualFlow): (id: string) => string {
  const expectedById = new Map(reference.nodes.map(n => [n.id, n]))
  const actualById = new Map(actual.nodes.map(n => [n.id, n]))

  const uniqueExpectedByType = uniqueTypeMap(reference.nodes)
  const cache = new Map<string, string>()

  return (id: string): string => {
    if (cache.has(id)) return cache.get(id)!
    let resolved = id
    if (!expectedById.has(id)) {
      const node = actualById.get(id)
      const type = node?.type
      if (type && (type === 'trigger' || type === 'llm' || type === 'endCall')) {
        const target = uniqueExpectedByType.get(type)
        if (target) resolved = target
      }
    }
    cache.set(id, resolved)
    return resolved
  }
}

/** Map a node TYPE to the single expected node id of that type (only when unique). */
function uniqueTypeMap(nodes: FlowNode[]): Map<string, string> {
  const counts = new Map<string, string[]>()
  for (const n of nodes) {
    const arr = counts.get(n.type) ?? []
    arr.push(n.id)
    counts.set(n.type, arr)
  }
  const out = new Map<string, string>()
  for (const [type, ids] of counts) if (ids.length === 1) out.set(type, ids[0]!)
  return out
}

/**
 * Attribute transcript entry idxs to the node each entry enacted (for highlighting).
 * Replays the transcript with the SAME mapping `actualFlow` used: the first agent
 * turn opens via the trigger; every spoken turn runs on the core llm node; each
 * `action_executed` maps to its action/router/endCall node. Reconciled to expected ids.
 */
function attributeEntries(
  transcript: Transcript,
  actual: ActualFlow,
  reference: FlowGraph,
  reconcile: (id: string) => string
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  const add = (nodeId: string, idx: number): void => {
    const arr = map.get(nodeId) ?? []
    arr.push(idx)
    map.set(nodeId, arr)
  }

  const triggerId = actual.nodes.find(n => n.type === 'trigger')?.id
  const coreId = actual.nodes.find(n => n.type === 'llm')?.id ?? actual.path[0]
  const actionByType = (type: FlowNode['type']): string | undefined =>
    actual.nodes.find(n => n.type === type)?.id

  let opened = false
  for (const entry of transcript.entries) {
    if (entry.role === 'action') {
      const name = entry.toolName.toLowerCase()
      let nodeId: string | undefined
      if (name === 'end_call' || entry.toolType.toLowerCase() === 'end_call') nodeId = actionByType('endCall')
      else if (name.includes('router')) nodeId = actionByType('router')
      else nodeId = actionByType('action')
      if (nodeId) add(reconcile(nodeId), entry.idx)
      continue
    }
    // A spoken turn. The opening agent turn is credited to the trigger entry once.
    if (!opened && entry.role === 'agent' && triggerId) {
      add(reconcile(triggerId), entry.idx)
      opened = true
    }
    if (coreId) add(reconcile(coreId), entry.idx)
  }
  void reference
  return map
}

function reasonForDrift(source: string, target: string, expectedIds: Set<string>): string {
  if (!expectedIds.has(target)) return 'Reached a node not present in the expected flow.'
  if (!expectedIds.has(source)) return 'Transition originated from an unexpected node.'
  return 'Transition not present in the expected flow.'
}

/* -------------------------------------------------------------------------- */
/* Number helpers                                                             */
/* -------------------------------------------------------------------------- */

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
function clamp01(n: number): number {
  return clamp(Number.isFinite(n) ? n : 0, 0, 1)
}

// Keep the TranscriptEntry import meaningful for downstream type-narrowing users.
export type { TranscriptEntry }
