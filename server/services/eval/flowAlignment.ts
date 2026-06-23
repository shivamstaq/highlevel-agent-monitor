// CREATED (our eval layer) — R3 primary drift overlay.
/**
 * Flow alignment — overlay ONE call's drift onto the agent's inferred call flow.
 * Runs the `flowAlignment` prompt (judges the transcript against the intended-flow
 * nodes) and returns the per-node alignment + off-script tangents, plus provenance.
 */
import type { Agent, FlowAlignment, InferredFlow, Transcript } from '#shared/types'
import { FlowAlignmentSchema } from '#shared/types'
import { generateStructured, type GenerateMeta } from '../llm/generateStructured'

export interface FlowAlignmentOutput {
  alignment: FlowAlignment
  meta: GenerateMeta
}

const FALLBACK_META: GenerateMeta = {
  provider: 'none',
  model: 'none',
  promptId: 'flowAlignment',
  promptVersion: '0',
  usedFallback: true
}

export async function runFlowAlignment(
  agent: Agent,
  inferredFlow: InferredFlow,
  transcript: Transcript
): Promise<FlowAlignmentOutput> {
  const callId = transcript.callId
  if (inferredFlow.nodes.length === 0) {
    return {
      alignment: FlowAlignmentSchema.parse({ callId, summary: '', nodeAlignments: [], tangents: [] }),
      meta: FALLBACK_META
    }
  }

  const turns = transcript.entries
    .filter((e): e is Extract<typeof e, { role: 'agent' | 'customer' }> =>
      e.role === 'agent' || e.role === 'customer')
    .map(t => ({ idx: t.idx, role: t.role, content: t.content }))
  const maxEntryIdx = transcript.entries.reduce((m, e) => Math.max(m, e.idx), 0)

  try {
    const { data, meta } = await generateStructured('flowAlignment', {
      agentName: agent.ghl.agentName,
      businessName: agent.ghl.businessName,
      flowSummary: inferredFlow.summary,
      nodes: inferredFlow.nodes.map(n => ({ id: n.id, label: n.label, kind: n.kind, description: n.description })),
      edges: inferredFlow.edges,
      turns,
      maxEntryIdx
    })
    const alignment = FlowAlignmentSchema.parse({
      callId,
      summary: data.summary,
      nodeAlignments: data.nodeAlignments,
      tangents: data.tangents
    })
    return { alignment, meta }
  } catch (err) {
    console.error(
      `[runFlowAlignment] failed for call ${callId}:`,
      err instanceof Error ? err.message : err
    )
    return {
      alignment: FlowAlignmentSchema.parse({ callId, summary: '', nodeAlignments: [], tangents: [] }),
      meta: FALLBACK_META
    }
  }
}
