/**
 * PromptSpec: successCriteria — author a weighted success rubric for an agent.
 *
 * LLM-AUTHORED (primary). The model PROPOSES the full success-criteria set for
 * THIS specific agent — labels, categories, weights and detectors are all
 * inferred from the real businessName/goal/agentPrompt/welcome/flow-node labels,
 * NOT stamped from fixed constants. The eval layer (`criteria.ts`) then only
 * NORMALISES that set (stable slug ids, 3–6 count, weight renormalisation,
 * dedupe, default-detector fill) — it no longer overrides the model's authorship.
 *
 * The model picks each criterion's `kind` as a FREE-FORM category slug (e.g.
 * outcome / process / communication / compliance) rather than choosing from a
 * closed enum baked into the prompt — the downstream normaliser maps the slug
 * onto the persisted `CriterionKind` vocabulary so the contract stays valid.
 *
 * `role: 'reasoner'` (criteria derivation needs reasoning + structured output).
 * `fallback` is the SECONDARY safety net only: it yields an empty bag so that on
 * the mock provider / any failure the eval layer falls back to its deterministic
 * spec-derived rubric (documented zero-cost path) instead of LLM authorship.
 */
import { z } from 'zod'
import type { Agent } from '#shared/types'
import { AgentSchema } from '#shared/types'
import { definePrompt } from './types'

/**
 * What we ask the provider to AUTHOR — the full criteria set. `kind` is a
 * free-form category slug chosen by the model (normalised downstream); `weight`
 * is a 0–1 importance the model assigns (renormalised to sum to 1 downstream).
 */
export const ProviderCriteriaSchema = z.object({
  criteria: z
    .array(
      z.object({
        /** Optional model-suggested id; the eval layer always re-slugs from the label. */
        id: z.string().optional(),
        /** Short human label for this criterion, specific to THIS agent. */
        label: z.string(),
        /** Free-form category slug the model infers (e.g. outcome/process/communication/compliance). */
        kind: z.string(),
        /** Relative importance in [0,1]; the set should roughly sum to ~1. */
        weight: z.number(),
        /** Concrete transcript evidence that proves the criterion was met. */
        detector: z.string()
      })
    )
    .default([])
})
export type ProviderCriteria = z.infer<typeof ProviderCriteriaSchema>

/** Schema name the provider sees — keep stable; the mock keys on it. */
const SCHEMA_NAME = 'SuccessCriteria'

const SYSTEM = [
  'You are a senior conversation-design QA lead for voice AI agents.',
  'Given ONE agent\'s real system prompt, welcome message and flow nodes, AUTHOR',
  'the success criteria a reviewer would score each of that agent\'s calls against.',
  '',
  'Derive the criteria from THIS agent\'s specifics — its business, its stated goal,',
  'the concrete steps/questions in its prompt and flow, and any obligation the',
  'prompt implies. Do NOT emit generic, one-size-fits-all criteria; the labels and',
  'detectors must read as if written for this exact agent and could not be pasted',
  'onto an unrelated agent unchanged.',
  '',
  'Output 3 to 6 criteria. For EACH criterion provide:',
  '  - label: a short, agent-specific human label.',
  '  - kind: a lowercase category slug YOU choose that best fits the criterion',
  '    (for example outcome, process, communication, or compliance — pick the',
  '    word that fits; you are not limited to those).',
  '  - weight: a number in [0,1] reflecting its importance; the weights across all',
  '    criteria should sum to roughly 1.',
  '  - detector: a concrete, transcript-checkable rule naming the specific evidence',
  '    that proves the criterion was met for this agent.',
  '',
  'Cover the agent\'s PRIMARY outcome (its goal) plus the behaviours, tone and any',
  'compliance/disclosure duties that matter for THIS agent. Return ONLY the',
  'structured object.'
].join('\n')

function buildUserPrompt(agent: Agent): string {
  const { ghl, flow } = agent
  const nodeLines = flow.nodes
    .map((n) => {
      const tools = n.data.tools?.length ? ` tools=[${n.data.tools.join(', ')}]` : ''
      const prompt = n.data.prompt ? ` prompt="${truncate(n.data.prompt, 280)}"` : ''
      return `- nodeId=${n.id} [${n.type}] ${n.data.displayName}${tools}${prompt}`
    })
    .join('\n')

  return [
    `AGENT: ${ghl.agentName} @ ${ghl.businessName} (type=${ghl.agentType}, lang=${ghl.language})`,
    '',
    'WELCOME MESSAGE:',
    ghl.welcomeMessage || '(none)',
    '',
    'SYSTEM PROMPT:',
    ghl.agentPrompt || '(none)',
    '',
    'FLOW NODES:',
    nodeLines || '(none)'
  ].join('\n')
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

export const successCriteriaPrompt = definePrompt<Agent, ProviderCriteria>({
  id: 'successCriteria',
  version: '2.0.0',
  role: 'reasoner',
  mode: 'tool',
  schemaName: SCHEMA_NAME,
  inputSchema: AgentSchema,
  outputSchema: ProviderCriteriaSchema,
  system: () => SYSTEM,
  user: agent => buildUserPrompt(agent),
  // SECONDARY safety net only: an empty bag triggers the eval layer's
  // deterministic spec-derived rubric on mock/failure (zero LLM spend).
  fallback: () => ({ criteria: [] }),
  maxTokens: 1024
})
