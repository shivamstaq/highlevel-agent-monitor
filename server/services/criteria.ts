import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { SuccessCriterionSchema } from '#shared/types'
import type { Agent, SuccessCriterion } from '#shared/types'
import { upsertAgent } from './db'
import { getProvider } from './llm'
import type { LLMProvider } from './llm'

/** The provider returns criteria without ids; we assign them after validation. */
const DerivedCriterionSchema = SuccessCriterionSchema.omit({ id: true })
const CriteriaResultSchema = z.object({
  criteria: z.array(DerivedCriterionSchema).min(3).max(5)
})

// No name argument: keeps the root as a plain { type: "object", ... } schema
// (Anthropic input_schema / Ollama `format` reject a { $ref, definitions } wrapper).
const CRITERIA_JSON_SCHEMA = zodToJsonSchema(CriteriaResultSchema)

const SYSTEM_PROMPT = [
  'You are a Voice AI QA architect. Given a voice agent\'s goal and script, define 3-5',
  'concrete, measurable success criteria the agent should be judged against on every call.',
  'Cover a mix of kinds: outcome (did it achieve the goal), behavior (did it follow the',
  'script), compliance (required disclosures/consent, when relevant), and tone.',
  'Each criterion needs: a short label, a kind, a weight in [0,1] (weights should sum to ~1),',
  'and a "detector" — a precise natural-language rule an analyst checks the transcript against.',
  'Return only the structured result.'
].join(' ')

/**
 * Ensure the agent has success criteria. If `successCriteria` is empty, derive
 * 3-5 criteria from the agent's goal + script via the provider, persist them on
 * the agent, and return the updated agent. Cached: agents that already have
 * criteria are returned unchanged.
 */
export async function ensureCriteria(agent: Agent, provider?: LLMProvider): Promise<Agent> {
  if (agent.successCriteria.length > 0) {
    return agent
  }

  const llm = provider ?? (await getProvider())
  const user = [
    `Agent name: ${agent.name}`,
    `Goal: ${agent.goal}`,
    `Script:\n${agent.script || '(no script provided)'}`
  ].join('\n\n')

  const raw = await llm.complete({
    system: SYSTEM_PROMPT,
    user,
    schema: CRITERIA_JSON_SCHEMA,
    schemaName: 'SuccessCriteria'
  })

  const parsed = CriteriaResultSchema.parse(raw)
  const criteria: SuccessCriterion[] = parsed.criteria.map(c => ({
    ...c,
    id: slugId(c.label)
  }))

  const updated: Agent = {
    ...agent,
    successCriteria: dedupeIds(criteria),
    updatedAt: new Date().toISOString()
  }
  return upsertAgent(updated)
}

/** Stable, readable id from a label, with a uuid suffix only if empty. */
function slugId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return slug || `criterion_${randomUUID().slice(0, 8)}`
}

/** Guarantee unique criterion ids. */
function dedupeIds(criteria: SuccessCriterion[]): SuccessCriterion[] {
  const seen = new Set<string>()
  return criteria.map((c) => {
    let id = c.id
    while (seen.has(id)) id = `${c.id}_${randomUUID().slice(0, 4)}`
    seen.add(id)
    return { ...c, id }
  })
}
