import { createHash, randomUUID } from 'node:crypto'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ExpectedFlowResultSchema } from '#shared/types'
import type { Agent, ExpectedFlow, FlowNode } from '#shared/types'
import { getExpectedFlow, upsertExpectedFlow } from './db'
import { getProvider } from './llm'
import type { LLMProvider } from './llm'

// Plain { type: "object", ... } root (Anthropic input_schema / Ollama `format`
// reject a { $ref, definitions } wrapper), so pass no schema name here.
const FLOW_JSON_SCHEMA = zodToJsonSchema(ExpectedFlowResultSchema)

const SYSTEM_PROMPT = [
  'You are a Voice AI conversation designer. Given an agent\'s goal, script, and success',
  'criteria, compile the EXPECTED call flow: the decision graph the agent should follow on a',
  'typical call, BEFORE any call happens. This is the design-intent the agent will be measured',
  'against.',
  '',
  'Produce 4-9 nodes. Each node has: a stable slug id (snake_case, e.g. "collect_callback"),',
  'a short human label, and a kind from: greeting, intent, qualify, collect, confirm, objection,',
  'action, close. Set expected=true for stages that should occur on EVERY successful call, and',
  'expected=false for conditional branches (e.g. an "objection" node only reached if the caller',
  'objects) — list its branchConditions as short natural-language guards.',
  '',
  'Produce edges connecting nodes in the intended order (from -> to), with an optional condition',
  'on branching edges. The main path should be a clear linear spine (greeting -> ... -> close)',
  'with conditional branches off it. Return only the structured result.'
].join('\n')

/**
 * Ensure the agent has an expected call flow. Cached by `specHash` over the
 * agent's goal + script + criteria, so the flow is regenerated only when the
 * agent's design actually changes. Returns the persisted ExpectedFlow.
 */
export async function ensureExpectedFlow(agent: Agent, provider?: LLMProvider): Promise<ExpectedFlow> {
  const specHash = hashSpec(agent)
  const cached = await getExpectedFlow(agent.id)
  if (cached && cached.specHash === specHash) {
    return cached
  }

  const llm = provider ?? (await getProvider())
  const user = buildUserPrompt(agent)

  const raw = await llm.complete({
    system: SYSTEM_PROMPT,
    user,
    schema: FLOW_JSON_SCHEMA,
    schemaName: 'ExpectedFlow'
  })

  const parsed = ExpectedFlowResultSchema.parse(raw)
  const nodes = dedupeNodeIds(parsed.nodes.map(n => ({ ...n, id: slugId(n.label, n.id) })))

  // Remap edges onto any ids we rewrote (match by original id where possible).
  const idByOriginal = new Map(parsed.nodes.map((n, i) => [n.id, nodes[i]!.id]))
  const validIds = new Set(nodes.map(n => n.id))
  const edges = parsed.edges
    .map(e => ({ ...e, from: idByOriginal.get(e.from) ?? e.from, to: idByOriginal.get(e.to) ?? e.to }))
    .filter(e => validIds.has(e.from) && validIds.has(e.to))

  const flow: ExpectedFlow = {
    nodes,
    edges,
    agentId: agent.id,
    provider: llm.name,
    model: llm.model,
    specHash,
    createdAt: new Date().toISOString()
  }
  return upsertExpectedFlow(flow)
}

function buildUserPrompt(agent: Agent): string {
  const criteria = agent.successCriteria
    .map(c => `- [${c.kind}] ${c.label}: ${c.detector}`)
    .join('\n')
  return [
    `Agent name: ${agent.name}`,
    `Goal: ${agent.goal}`,
    `Script:\n${agent.script || '(no script provided)'}`,
    '',
    'Success criteria:',
    criteria || '(none yet)'
  ].join('\n')
}

/** Hash the agent's design so the flow regenerates only when the design changes. */
function hashSpec(agent: Agent): string {
  const canonical = JSON.stringify({
    goal: agent.goal,
    script: agent.script,
    criteria: agent.successCriteria.map(c => `${c.kind}:${c.label}`).sort()
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function slugId(label: string, fallback: string): string {
  const base = (label || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return base || `node_${randomUUID().slice(0, 8)}`
}

function dedupeNodeIds(nodes: FlowNode[]): FlowNode[] {
  const seen = new Set<string>()
  return nodes.map((n) => {
    let id = n.id
    while (seen.has(id)) id = `${n.id}_${randomUUID().slice(0, 4)}`
    seen.add(id)
    return { ...n, id }
  })
}
