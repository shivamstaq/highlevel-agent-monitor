/**
 * PromptSpec: inferredFlow (R3) — reconstruct the agent's COMPLETE call-handling
 * flow from its real instructions.
 *
 * The LLM reads the agent's system prompt (+ its inferred checkpoints for
 * grounding) and emits a directed graph of how the agent SHOULD operate: the main
 * path plus every decision branch (question vs booking, caller wants a human,
 * missing info, tool match vs no match, …), tool/action steps, handoffs and end
 * states. This is the "as-intended" route map — NOT the borrowed GHL flow graph.
 *
 * `role: 'reasoner'` (Sonnet). The deterministic `fallback` builds a route map
 * from the checkpoints (main spine) + their edge cases (branches), so the agent
 * page always has a graph to render at zero LLM spend.
 */
import { z } from 'zod'
import type { InferredFlowEdge, InferredFlowNode } from '#shared/types'
import { InferredFlowNodeSchema, InferredFlowEdgeSchema } from '#shared/types'
import { definePrompt } from './types'

const CheckpointInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  expectation: z.string().default(''),
  edgeCases: z
    .array(z.object({ condition: z.string(), expectedBehavior: z.string() }))
    .default([])
})

export const InferredFlowVarsSchema = z.object({
  agentName: z.string(),
  businessName: z.string(),
  agentPrompt: z.string().default(''),
  checkpoints: z.array(CheckpointInputSchema).default([])
})
export type InferredFlowVars = z.infer<typeof InferredFlowVarsSchema>

export const InferredFlowResultSchema = z.object({
  summary: z.string().default(''),
  nodes: z.array(InferredFlowNodeSchema),
  edges: z.array(InferredFlowEdgeSchema).default([])
})
export type InferredFlowResult = z.infer<typeof InferredFlowResultSchema>

const SCHEMA_NAME = 'InferredCallFlow'

const SYSTEM = [
  'You are a conversation architect for voice AI phone agents.',
  'Read ONE agent\'s real instructions (and its inferred checkpoints) and',
  'reconstruct the COMPLETE call-handling flow the agent SHOULD follow — as a',
  'directed graph of how it ought to behave depending on how the caller engages.',
  '',
  'Capture ALL the meaningful routes, not just the happy path:',
  '• the main path from call start to a successful end;',
  '• decision branches where the conversation can fork (e.g. caller asks a question',
  '  vs wants to book; query matches a tool vs does not; caller wants a human;',
  '  required info is missing; caller is upset);',
  '• tool / action steps the agent should invoke;',
  '• handoff / escalation routes; and the distinct end states.',
  '',
  'Output a graph:',
  '- `nodes`: each with a unique lower_snake_case `id`, a short `label`, a `kind`',
  '  (one of: start, message, decision, collect, tool, handoff, end), and a',
  '  one-line `description` of what the agent does or decides there. Include exactly',
  '  one `start` node and at least one `end` node. Aim for 6–14 nodes — enough to',
  '  show the real branches, not so many it is noise.',
  '- `edges`: each `source` -> `target` referencing real node ids. For edges',
  '  leaving a `decision` (or any branch), set `condition` to the caller path that',
  '  takes that route (e.g. "caller wants to book", "no tool matches", "caller asks',
  '  for a human"). Leave `condition` empty for a single linear next-step.',
  '- `summary`: ONE sentence on how this agent is meant to operate.',
  '',
  'Ground everything in THIS agent\'s instructions. Return ONLY the structured object.'
].join('\n')

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function buildUserPrompt(vars: InferredFlowVars): string {
  const cps = vars.checkpoints.length
    ? vars.checkpoints
        .map((c) => {
          const edges = c.edgeCases.length
            ? c.edgeCases.map(e => `      · if ${e.condition} → ${e.expectedBehavior}`).join('\n')
            : '      · (none)'
          return [`  - [${c.id}] ${c.label}: ${c.expectation}`, '    edge cases:', edges].join('\n')
        })
        .join('\n')
    : '  (none inferred)'
  return [
    `AGENT: ${vars.agentName} @ ${vars.businessName}`,
    '',
    'INSTRUCTIONS / SYSTEM PROMPT:',
    vars.agentPrompt ? clip(vars.agentPrompt, 4000) : '(none)',
    '',
    'INFERRED CHECKPOINTS (grounding):',
    cps
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/* Guardrail — structural graph validity.                                      */
/* -------------------------------------------------------------------------- */

function flowGuardrail(out: InferredFlowResult): void {
  if (out.nodes.length < 3) throw new Error('inferredFlow: need at least 3 nodes')
  const ids = new Set<string>()
  let starts = 0
  let ends = 0
  for (const n of out.nodes) {
    if (!n.id.trim() || !n.label.trim()) throw new Error('inferredFlow: node id/label must be non-empty')
    if (ids.has(n.id)) throw new Error(`inferredFlow: duplicate node id '${n.id}'`)
    ids.add(n.id)
    if (n.kind === 'start') starts++
    if (n.kind === 'end') ends++
  }
  if (starts !== 1) throw new Error(`inferredFlow: expected exactly one start node, got ${starts}`)
  if (ends < 1) throw new Error('inferredFlow: expected at least one end node')
  for (const e of out.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new Error(`inferredFlow: edge ${e.source}->${e.target} references an unknown node`)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback — main spine from checkpoints + branches from edges. */
/* -------------------------------------------------------------------------- */

function slug(s: string, i: number): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return base || `node_${i}`
}

function deterministicFlow(vars: InferredFlowVars): InferredFlowResult {
  const nodes: InferredFlowNode[] = [{ id: 'start', label: 'Call starts', kind: 'start', description: 'The caller connects.' }]
  const edges: InferredFlowEdge[] = []

  const cps = vars.checkpoints
  if (cps.length === 0) {
    nodes.push({ id: 'handle', label: 'Handle the call', kind: 'message', description: 'Assist the caller per the agent\'s instructions.' })
    nodes.push({ id: 'end', label: 'Call ends', kind: 'end', description: 'The call concludes.' })
    edges.push({ source: 'start', target: 'handle' }, { source: 'handle', target: 'end' })
    return { summary: 'Single-path call handling.', nodes, edges }
  }

  let prev = 'start'
  cps.forEach((c, i) => {
    const id = slug(c.id || c.label, i)
    nodes.push({ id, label: c.label, kind: i === 0 ? 'message' : 'message', description: c.expectation })
    edges.push({ source: prev, target: id })
    // Branch nodes from edge cases (alternative handling routes).
    c.edgeCases.forEach((ec, j) => {
      const bid = `${id}_alt${j}`
      nodes.push({ id: bid, label: clip(ec.expectedBehavior, 40), kind: 'handoff', description: ec.expectedBehavior })
      edges.push({ source: id, target: bid, condition: ec.condition })
    })
    prev = id
  })
  nodes.push({ id: 'end', label: 'Call ends', kind: 'end', description: 'The call concludes.' })
  edges.push({ source: prev, target: 'end' })

  return { summary: 'Call-handling flow reconstructed from the agent\'s checkpoints.', nodes, edges }
}

export const inferredFlowPrompt = definePrompt<InferredFlowVars, InferredFlowResult>({
  id: 'inferredFlow',
  version: '1.0.0',
  role: 'reasoner',
  mode: 'tool',
  schemaName: SCHEMA_NAME,
  inputSchema: InferredFlowVarsSchema,
  outputSchema: InferredFlowResultSchema,
  system: () => SYSTEM,
  user: vars => buildUserPrompt(vars),
  guardrails: [flowGuardrail],
  fallback: vars => deterministicFlow(vars),
  maxTokens: 4096
})
