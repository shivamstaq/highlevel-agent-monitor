/**
 * Flow conformance — aligns the ACTUAL call (LLM-labeled turn -> flow-node) to
 * the agent's EXPECTED flow and scores drift. This is the deterministic half of
 * the hybrid: the LLM does the semantic labeling (hard, non-reproducible part),
 * this does the scoring (must be reproducible and testable). Process-mining
 * alignment semantics: hit (synchronous), skipped (model move on a required
 * node), out_of_order (precedence violation), extra (log move / no model node).
 */
import type { ExpectedFlow, FlowAlignment, NodeAlignment, NodeStatus, StageLabel } from '#shared/types'

export function alignFlow(flow: ExpectedFlow, labels: StageLabel[], agentId: string, callId: string): FlowAlignment {
  const rank = topoRank(flow)
  const validIds = new Set(flow.nodes.map(n => n.id))
  const ordered = [...labels].sort((a, b) => a.turnIdx - b.turnIdx)

  // Resolve each label to an expected node id. Models reliably emit the node
  // KIND but often leave nodeId null, so fall back to matching by kind (advancing
  // through same-kind nodes in order). A label that matches nothing stays null
  // (an 'extra'/inserted behavior).
  const kindCursor = new Map<string, number>()
  const resolved: { turnIdx: number, nodeId: string | null, kind: StageLabel['kind'] }[] = ordered.map((l) => {
    if (l.nodeId && validIds.has(l.nodeId)) return { turnIdx: l.turnIdx, nodeId: l.nodeId, kind: l.kind }
    const sameKind = flow.nodes.filter(n => n.kind === l.kind)
    if (sameKind.length === 0) return { turnIdx: l.turnIdx, nodeId: null, kind: l.kind }
    const cursor = kindCursor.get(l.kind) ?? 0
    kindCursor.set(l.kind, cursor + 1)
    return { turnIdx: l.turnIdx, nodeId: sameKind[Math.min(cursor, sameKind.length - 1)]!.id, kind: l.kind }
  })

  // First turn at which each expected node was enacted.
  const firstTurn = new Map<string, number>()
  const matchedTurns = new Map<string, number[]>()
  for (const l of resolved) {
    if (!l.nodeId) continue
    if (!firstTurn.has(l.nodeId)) firstTurn.set(l.nodeId, l.turnIdx)
    matchedTurns.set(l.nodeId, [...(matchedTurns.get(l.nodeId) ?? []), l.turnIdx])
  }
  const nodeAlignments: NodeAlignment[] = []

  for (const node of flow.nodes) {
    const turns = matchedTurns.get(node.id) ?? []
    let status: NodeStatus
    let driftScore: number
    let note: string | undefined

    if (turns.length === 0) {
      if (node.expected) {
        status = 'skipped'
        driftScore = 1
        note = 'Required step never occurred in the call.'
      } else {
        status = 'skipped'
        driftScore = 0
        note = 'Conditional branch not triggered (expected — no drift).'
      }
    } else if (isOutOfOrder(node.id, rank, firstTurn)) {
      status = 'out_of_order'
      driftScore = 0.5
      note = 'Occurred earlier than its place in the designed flow.'
    } else {
      status = 'hit'
      driftScore = 0
    }

    nodeAlignments.push({ nodeId: node.id, label: node.label, kind: node.kind, status, driftScore, matchedTurnIdxs: turns, note })
  }

  // Extra: labeled behavior with no expected node (couldn't resolve by id or kind).
  const extraByKey = new Map<string, { kind: StageLabel['kind'], turns: number[] }>()
  for (const l of resolved) {
    if (l.nodeId) continue
    const key = `kind:${l.kind}`
    const cur = extraByKey.get(key) ?? { kind: l.kind, turns: [] }
    cur.turns.push(l.turnIdx)
    extraByKey.set(key, cur)
  }
  for (const [key, v] of extraByKey) {
    nodeAlignments.push({
      label: key.startsWith('kind:') ? `Unplanned ${v.kind}` : key,
      kind: v.kind,
      status: 'extra',
      driftScore: 0.6,
      matchedTurnIdxs: v.turns,
      note: 'Behavior not present in the designed flow.'
    })
  }

  // Fitness = required expected nodes that were hit / total required.
  const required = flow.nodes.filter(n => n.expected)
  const requiredHit = required.filter(n => (matchedTurns.get(n.id)?.length ?? 0) > 0 && !isOutOfOrder(n.id, rank, firstTurn))
  const fitness = required.length ? requiredHit.length / required.length : 1

  const outOfOrder = nodeAlignments.filter(n => n.status === 'out_of_order').length
  const extras = nodeAlignments.filter(n => n.status === 'extra').length
  const conformanceScore = Math.max(0, Math.min(100, Math.round(fitness * 100 - outOfOrder * 8 - extras * 4)))

  const actualPath = collapse(resolved.filter(l => l.nodeId).map(l => l.nodeId as string))

  return { callId, agentId, conformanceScore, fitness: Math.round(fitness * 100) / 100, nodeAlignments, actualPath }
}

/** A node is out of order if a designed predecessor occurred after it. */
function isOutOfOrder(nodeId: string, rank: Map<string, number>, firstTurn: Map<string, number>): boolean {
  const r = rank.get(nodeId)
  const t = firstTurn.get(nodeId)
  if (r == null || t == null) return false
  for (const [otherId, ot] of firstTurn) {
    if (otherId === nodeId) continue
    const or = rank.get(otherId)
    if (or == null) continue
    if (or < r && ot > t) return true // a predecessor (lower rank) happened later
  }
  return false
}

/** Topological-ish rank from edges; falls back to declaration order. */
function topoRank(flow: ExpectedFlow): Map<string, number> {
  const rank = new Map<string, number>()
  flow.nodes.forEach((n, i) => rank.set(n.id, i))
  // Refine with a longest-path-from-start pass over edges (stable for DAG-ish flows).
  const adj = new Map<string, string[]>()
  for (const e of flow.edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
  const indeg = new Map<string, number>()
  for (const n of flow.nodes) indeg.set(n.id, 0)
  for (const e of flow.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const queue = flow.nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id)
  let order = 0
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    rank.set(id, order++)
    for (const to of adj.get(id) ?? []) {
      const d = (indeg.get(to) ?? 0) - 1
      indeg.set(to, d)
      if (d <= 0) queue.push(to)
    }
  }
  return rank
}

function collapse(ids: string[]): string[] {
  const out: string[] = []
  for (const id of ids) if (out[out.length - 1] !== id) out.push(id)
  return out
}
