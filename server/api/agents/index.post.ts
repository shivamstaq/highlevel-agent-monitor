/**
 * POST /api/agents -> { agent, flow }
 *
 * Create a Voice AI agent. Immediately derives its success criteria AND its
 * expected call flow (the design-intent graph) so observability is configured
 * BEFORE the agent ever takes a call. Body: { name, goal, script? }.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Agent, ExpectedFlow } from '#shared/types'
import { upsertAgent } from '../../services/db'
import { ensureCriteria } from '../../services/criteria'
import { ensureExpectedFlow } from '../../services/flow'
import { getProvider } from '../../services/llm'

const BodySchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  script: z.string().optional().default('')
})

export default defineEventHandler(async (event): Promise<{ agent: Agent, flow: ExpectedFlow }> => {
  const body = BodySchema.parse(await readBody(event))
  const now = new Date().toISOString()

  const base: Agent = {
    id: `agent-${slug(body.name)}-${randomUUID().slice(0, 6)}`,
    name: body.name,
    goal: body.goal,
    script: body.script,
    successCriteria: [],
    createdAt: now,
    updatedAt: now
  }

  const stored = await upsertAgent(base)
  const provider = await getProvider()
  const withCriteria = await ensureCriteria(stored, provider)
  const flow = await ensureExpectedFlow(withCriteria, provider)

  // ensureCriteria persisted criteria onto the agent; return that latest version.
  return { agent: withCriteria, flow }
})

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'agent'
}
