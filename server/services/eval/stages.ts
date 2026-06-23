// CREATED (our eval layer)
/**
 * Agent stage inference (R2 §1.4) — derive THIS agent's conversational stage
 * vocabulary via the dynamic-LLM seam, with a spec-hash cache so we never re-bill
 * for an unchanged agent.
 *
 * `inferAgentStages(agent)` builds the `stageInference` prompt vars from the REAL
 * agent spec (name, prompt, business, flow node display names, criteria labels),
 * runs `generateStructured('stageInference', …)` (role: reasoner → Sonnet 4.6,
 * cost-low) and returns an `AgentStageSet` carrying the inferred `StageNode[]`, the
 * agentId and a `specHash` (the cache key). The membership is INFERRED — there is
 * no hardcoded stage enum; the prompt's structural guardrails + deterministic
 * fallback (a grounded spine from the flow node labels) live in the prompt spec.
 *
 * Caching: keyed `stages:<agentId>` in storage. A stored set is reused verbatim
 * when its `specHash` matches the agent's current spec hash; otherwise it is
 * re-inferred and re-persisted. This makes the LLM call idempotent per agent spec.
 */
import { createHash } from 'node:crypto'
import type { Agent, AgentStageSet } from '#shared/types'
import { AgentStageSetSchema } from '#shared/types'
import { generateStructured, type GenerateMeta } from '../llm/generateStructured'
import { getSetting, setSetting } from '../db'

export interface InferAgentStagesResult {
  stageSet: AgentStageSet
  /** Provider/model/usedFallback provenance for the inference call (undefined on a cache hit). */
  meta?: GenerateMeta
  /** True when a cached set with the same specHash was reused (no LLM call). */
  cached: boolean
}

/**
 * Infer (or reuse) the agent's stage vocabulary. Best-effort: any storage/LLM
 * failure still yields a valid `AgentStageSet` (the prompt fallback guarantees a
 * grounded spine), so the analysis pipeline never crashes on stage inference.
 */
export async function inferAgentStages(agent: Agent): Promise<InferAgentStagesResult> {
  const agentId = agent.ghl.id
  const specHash = hashAgentSpec(agent)
  const cacheKey = `stages:${agentId}`

  // ── cache hit: reuse a stored set whose specHash matches the current spec ──
  try {
    const stored = await getSetting(cacheKey)
    if (stored) {
      const parsed = AgentStageSetSchema.safeParse(stored)
      if (parsed.success && parsed.data.specHash === specHash) {
        return { stageSet: parsed.data, cached: true }
      }
    }
  } catch {
    // Storage unavailable — fall through to (re-)inference.
  }

  // ── infer via the dynamic-LLM seam (guardrailed; deterministic fallback) ──
  const { data, meta } = await generateStructured('stageInference', {
    agentName: agent.ghl.agentName,
    agentPrompt: agent.ghl.agentPrompt,
    businessName: agent.ghl.businessName,
    flowNodeLabels: agent.flow.nodes.map(n => n.data.displayName),
    criteriaLabels: agent.successCriteria.map(c => c.label)
  })

  const stageSet = AgentStageSetSchema.parse({
    agentId,
    specHash,
    stages: data.stages
  })

  // Persist for reuse (best-effort — never block analysis on a write failure).
  try {
    await setSetting(cacheKey, stageSet)
  } catch {
    // ignore
  }

  return { stageSet, meta, cached: false }
}

/**
 * Hash the slice of the agent spec the stage vocabulary is derived from. A change
 * to the prompt, business, flow node labels or criteria labels re-keys the cache;
 * unrelated config churn does not.
 */
/**
 * Bumped whenever the stage VOCABULARY shape changes (not just the agent spec),
 * so a richer prompt re-keys every cached set. v2 added per-checkpoint
 * `expectation` + `edgeCases`.
 */
const STAGE_VOCAB_VERSION = 'v3'

function hashAgentSpec(agent: Agent): string {
  const basis = JSON.stringify({
    v: STAGE_VOCAB_VERSION,
    a: agent.ghl.agentName,
    b: agent.ghl.businessName,
    p: agent.ghl.agentPrompt,
    n: agent.flow.nodes.map(n => n.data.displayName),
    c: agent.successCriteria.map(c => c.label)
  })
  return createHash('sha256').update(basis).digest('hex').slice(0, 32)
}
