// CREATED (our eval layer) — R3.
/**
 * Inferred call flow — reconstruct, from the agent's real instructions, the
 * COMPLETE route map of how it SHOULD handle a call (main path + every decision
 * branch / tool / handoff / end). Runs the `inferredFlow` prompt, grounded by the
 * agent's cached checkpoints when available, with a spec-hash cache so we never
 * re-bill for an unchanged agent. Best-effort: any failure degrades to the prompt's
 * deterministic fallback (a spine from the checkpoints), so the agent page always
 * has a flow to render.
 */
import { createHash } from 'node:crypto'
import type { Agent, AgentStageSet, InferredFlow } from '#shared/types'
import { AgentStageSetSchema, InferredFlowSchema } from '#shared/types'
import { generateStructured } from '../llm/generateStructured'
import { getSetting, setSetting } from '../db'

/** Bump when the inferred-flow shape/prompt changes (re-keys every cached graph). */
const INFERRED_FLOW_VERSION = 'v1'

function hashSpec(agent: Agent): string {
  const basis = JSON.stringify({
    v: INFERRED_FLOW_VERSION,
    n: agent.ghl.agentName,
    b: agent.ghl.businessName,
    p: agent.ghl.agentPrompt
  })
  return createHash('sha256').update(basis).digest('hex').slice(0, 32)
}

/**
 * Read-only: return the agent's cached inferred flow, or null if not derived yet.
 * Safe to call from a GET (never makes an LLM call). The full derivation runs in
 * the analyze pipeline; reads just surface the cached graph.
 */
export async function getCachedInferredFlow(agentId: string): Promise<InferredFlow | null> {
  try {
    const stored = await getSetting(`inferredFlow:${agentId}`)
    if (!stored) return null
    const parsed = InferredFlowSchema.safeParse(stored)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Read the agent's cached stage vocabulary (checkpoints) for grounding, if any. */
async function readCachedStages(agentId: string): Promise<AgentStageSet | null> {
  try {
    const raw = await getSetting(`stages:${agentId}`)
    if (!raw) return null
    const parsed = AgentStageSetSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Return the agent's inferred call flow, deriving + caching it on a miss. Keyed
 * `inferredFlow:<agentId>` by a spec hash of the prompt; an unchanged agent is a
 * cache hit (no LLM call).
 */
export async function getOrDeriveInferredFlow(agent: Agent): Promise<InferredFlow> {
  const agentId = agent.ghl.id
  const specHash = hashSpec(agent)
  const cacheKey = `inferredFlow:${agentId}`

  try {
    const stored = await getSetting(cacheKey)
    if (stored) {
      const parsed = InferredFlowSchema.safeParse(stored)
      if (parsed.success && parsed.data.specHash === specHash) return parsed.data
    }
  } catch {
    // fall through to derive
  }

  const stageSet = await readCachedStages(agentId)
  const { data, meta } = await generateStructured('inferredFlow', {
    agentName: agent.ghl.agentName,
    businessName: agent.ghl.businessName,
    agentPrompt: agent.ghl.agentPrompt,
    checkpoints: (stageSet?.stages ?? []).map(s => ({
      id: s.id,
      label: s.label,
      expectation: s.expectation,
      edgeCases: s.edgeCases
    }))
  })

  const flow = InferredFlowSchema.parse({
    agentId,
    summary: data.summary,
    nodes: data.nodes,
    edges: data.edges,
    specHash,
    usedFallback: meta.usedFallback
  })

  try {
    await setSetting(cacheKey, flow)
  } catch {
    // best-effort persist
  }

  return flow
}
