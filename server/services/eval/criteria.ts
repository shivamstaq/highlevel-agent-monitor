// CREATED (our eval layer)
/**
 * deriveSuccessCriteria(agent) — turn a REAL agent spec (agentPrompt + welcome +
 * flow nodes) into a weighted rubric the analysis engine scores each call against.
 *
 * LLM-AUTHORED (primary). The success criteria are PROPOSED by the model from
 * THIS agent's businessName/goal/agentPrompt/welcome/flow-node labels via the
 * shared LLM seam (`generateStructured('successCriteria', agent)`). The model is
 * the author of the labels, categories, weights and detectors — there is NO
 * hard-coded rubric stamped on top of a real provider's answer.
 *
 * The deterministic logic here only NORMALISES the model's set into a
 * contract-valid `SuccessCriterion[]`: stable slug ids, a 3–6 count, the
 * free-form `kind` slug mapped onto the persisted `CriterionKind` vocabulary,
 * weights renormalised to sum to 1.0, dedupe, and a default detector filled only
 * where the model omitted one.
 *
 * The deterministic SPEC-DERIVED rubric (goal + script + tone + next-step/
 * compliance) survives ONLY as the documented SAFETY NET: it is used when the
 * model/path yields an EMPTY set (mock provider, or any seam failure) so the
 * mirror is never blocked and analysis never crashes on criteria derivation.
 */
import type { Agent, SuccessCriterion, CriterionKind } from '#shared/types'
import { SuccessCriterionSchema } from '#shared/types'
import { generateStructured } from '../llm/generateStructured'

/**
 * Derive (or refresh) the weighted success rubric for an agent.
 *
 * Best-effort / non-throwing: callers (analysis.ts, agents/sync.post.ts) depend
 * on this never crashing. On any failure, or when the LLM/mock path yields an
 * empty set, it returns the deterministic spec-derived rubric (the safety net).
 *
 * Idempotent-friendly: always recomputes from the current spec so a re-synced
 * prompt change is reflected.
 */
export async function deriveSuccessCriteria(agent: Agent): Promise<SuccessCriterion[]> {
  let fromProvider: ProviderCriterion[] = []
  try {
    const { data } = await generateStructured('successCriteria', agent)
    fromProvider = data.criteria
  } catch {
    // Any seam failure → empty provider set, which routes to the deterministic
    // safety net below (analysis must never crash on criteria derivation).
    fromProvider = []
  }

  // LLM output is the SOURCE OF TRUTH: normalise it into a contract-valid rubric.
  // Only when the model produced NOTHING do we fall back to the spec-derived set.
  return normalizeCriteria(fromProvider, agent)
}

/* -------------------------------------------------------------------------- */
/* Normalisation — turn the LLM-authored set into a contract-valid rubric.     */
/* -------------------------------------------------------------------------- */

interface ProviderCriterion {
  id?: string
  label: string
  kind: string
  weight: number
  detector: string
}

/**
 * Normalise the model's authored criteria into a valid, weight-normalised
 * `SuccessCriterion[]`. The model is the author; this function assigns stable
 * ids, maps the free-form `kind` slug onto the persisted vocabulary, ensures a
 * 3–6 count (topping up from the spec-derived rubric ONLY if the model returned
 * fewer than 3), dedupes, renormalises weights and fills default detectors.
 *
 * If the model produced an EMPTY set (mock provider / seam failure), this returns
 * the deterministic spec-derived rubric in full — the documented safety net.
 */
function normalizeCriteria(provider: ProviderCriterion[], agent: Agent): SuccessCriterion[] {
  const out: SuccessCriterion[] = []
  const seen = new Set<string>()

  const push = (c: Omit<SuccessCriterion, 'weight'> & { weight: number }): boolean => {
    if (out.length >= 6) return false
    const id = uniqueId(slug(c.id || c.label), seen)
    seen.add(id)
    out.push({ ...c, id })
    return true
  }

  // 1. Primary path: take the model's authored criteria as-is (normalised).
  //    Highest-weight first so a >6 set keeps the criteria the model deemed most
  //    important, and dedupe drops near-duplicate labels.
  const authored = [...provider]
    .filter(c => typeof c?.label === 'string' && c.label.trim().length > 0)
    .sort((a, b) => clamp01(b.weight) - clamp01(a.weight))

  for (const c of authored) {
    push({
      id: c.id ? slug(c.id) : slug(c.label),
      label: truncate(c.label.trim(), 80),
      kind: mapKind(c.kind),
      weight: clamp01(c.weight) || 0.1,
      detector: (c.detector && c.detector.trim()) || defaultDetector(c.label, agent),
      derivedFrom: 'modeled'
    })
  }

  // 2. Safety net / top-up. If the model authored NOTHING, this rebuilds the full
  //    deterministic spec-derived rubric. If it authored 1–2 criteria, this tops
  //    the set up to >=3 from the spec WITHOUT displacing the model's authorship.
  if (out.length < 3) {
    for (const c of specRubric(agent)) {
      if (out.length >= 3) break
      push(c)
    }
  }

  return normalizeWeights(out).map(c => SuccessCriterionSchema.parse(c))
}

/**
 * Map the model's FREE-FORM category slug onto the persisted `CriterionKind`
 * vocabulary. The model authors the intent; this only reconciles its slug with
 * the contract enum (so we stay type-valid without baking the enum into the
 * prompt). Unknown slugs fall back to a sensible default by keyword.
 */
function mapKind(raw: string): CriterionKind {
  const k = (raw || '').toLowerCase().trim()
  if (/(outcome|goal|result|resolution|conversion|booking|appointment)/.test(k)) return 'outcome'
  if (/(complian|consent|disclos|privacy|hipaa|gdpr|legal|verif)/.test(k)) return 'compliance'
  if (/(tone|empath|courte|polite|rapport|warmth|sentiment|communicat|clarity|language)/.test(k)) return 'tone'
  if (/(behav|process|script|flow|procedure|step|adherence|accuracy|complete)/.test(k)) return 'behavior'
  // Default: most uncategorised criteria describe expected behaviour/process.
  return 'behavior'
}

/* -------------------------------------------------------------------------- */
/* Deterministic spec-derived rubric — the SAFETY NET (mock / empty / failure) */
/* -------------------------------------------------------------------------- */

/**
 * The deterministic, spec-anchored rubric. This is NO LONGER the primary source:
 * it is emitted only to top up (<3) or replace (empty) the LLM-authored set, so
 * the mirror/analysis path stays functional with zero LLM spend on the mock.
 */
function specRubric(agent: Agent): Array<Omit<SuccessCriterion, 'weight'> & { weight: number }> {
  const rubric: Array<Omit<SuccessCriterion, 'weight'> & { weight: number }> = []

  // Primary OUTCOME — the agent's stated goal, mined from the real prompt.
  rubric.push({
    id: 'goal_outcome',
    label: goalLabel(agent),
    kind: 'outcome',
    weight: 0.4,
    detector: goalDetector(agent),
    derivedFrom: 'prompt'
  })

  // Script BEHAVIOUR — the agent has a structured flow / script.
  if (hasScript(agent)) {
    rubric.push({
      id: 'follows_script',
      label: 'Follows the configured script & flow',
      kind: 'behavior',
      weight: 0.25,
      detector:
        'The agent covers the required script steps in order (per the system prompt and flow nodes) without skipping mandatory questions or steps.',
      derivedFrom: 'flow'
    })
  }

  // TONE — universally expected of a customer-facing agent.
  rubric.push({
    id: 'professional_tone',
    label: 'Professional, empathetic tone',
    kind: 'tone',
    weight: 0.2,
    detector:
      'The agent stays courteous, acknowledges the caller, mirrors the welcome message tone, and avoids robotic, dismissive or off-script phrasing.',
    derivedFrom: 'welcome'
  })

  // COMPLIANCE vs concrete-next-step — conditional on prompt signals.
  if (mentionsCompliance(agent)) {
    rubric.push({
      id: 'compliance_disclosure',
      label: 'Required disclosures & consent',
      kind: 'compliance',
      weight: 0.15,
      detector:
        'The agent gives required disclosures (recording/consent/identity verification) before collecting sensitive information, per the prompt.',
      derivedFrom: 'prompt'
    })
  } else {
    rubric.push({
      id: 'capture_next_step',
      label: 'Captures a concrete next step',
      kind: 'outcome',
      weight: 0.15,
      detector:
        'The agent confirms a specific next step (appointment, callback, or follow-up commitment) and reads back the captured details before ending the call.',
      derivedFrom: 'prompt'
    })
  }

  return rubric
}

/* -------------------------------------------------------------------------- */
/* Spec mining helpers                                                         */
/* -------------------------------------------------------------------------- */

function goalLabel(agent: Agent): string {
  const p = agent.ghl.agentPrompt.toLowerCase()
  if (/\bbook|appointment|schedul|reserv/.test(p)) return 'Books the requested appointment'
  if (/\bqualif|lead/.test(p)) return 'Qualifies the caller'
  if (/\bsupport|resolve|issue|ticket/.test(p)) return 'Resolves the caller’s request'
  if (/\bgather|collect|contact information/.test(p)) return 'Gathers required caller information'
  return 'Achieves the stated goal'
}

function goalDetector(agent: Agent): string {
  const goal = extractGoalSentence(agent.ghl.agentPrompt)
  return `The agent drives the call toward its primary goal and secures the intended outcome${goal ? ` (goal: ${goal})` : ''}.`
}

/** A sensible default detector when the model omitted one (label-anchored). */
function defaultDetector(label: string, agent: Agent): string {
  const goal = extractGoalSentence(agent.ghl.agentPrompt)
  return `The transcript shows the agent satisfied "${truncate(label.trim(), 80)}"${goal ? ` in service of its goal (${goal})` : ''}.`
}

/** Pull the first "goal"/"objective" sentence from the real prompt, if present. */
function extractGoalSentence(prompt: string): string {
  const m = prompt.match(/(?:your goal|objective|goal)\s*[:-]?\s*([^\n.]{8,160})/i)
  return m?.[1] ? truncate(m[1].trim(), 140) : ''
}

function hasScript(agent: Agent): boolean {
  if (/structured call flow|script|steps?:/i.test(agent.ghl.agentPrompt)) return true
  return agent.flow.nodes.some(n => n.type === 'llm' || n.type === 'router')
}

function mentionsCompliance(agent: Agent): boolean {
  return /(consent|record(ing)?|disclos|complian|hipaa|gdpr|verify identity|verification)/i.test(
    agent.ghl.agentPrompt
  )
}

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

function normalizeWeights(criteria: SuccessCriterion[]): SuccessCriterion[] {
  const total = criteria.reduce((s, c) => s + c.weight, 0)
  if (total <= 0) {
    // Degenerate (all-zero) weights → distribute evenly so weights still sum to 1.
    const even = criteria.length ? Math.round((1 / criteria.length) * 100) / 100 : 0
    return criteria.map(c => ({ ...c, weight: even }))
  }
  return criteria.map(c => ({ ...c, weight: Math.round((c.weight / total) * 100) / 100 }))
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'criterion'
  )
}

/** Ensure the slug is unique within the set (append _2, _3, … on collision). */
function uniqueId(base: string, seen: Set<string>): string {
  if (!seen.has(base)) return base
  let i = 2
  while (seen.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
