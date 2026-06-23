import type { LLMProvider, LLMRequest, LLMResult } from './types'

/**
 * OpenAI provider (R2) — plain `fetch` to the Chat Completions API, no SDK
 * dependency (keeps the Cloudflare Workers bundle lean).
 *
 * Structured output, two modes:
 *  - `json`  → `response_format: { type:'json_schema', json_schema:{ strict:true,
 *    schema } }`. The model returns the JSON object as the message content; we
 *    surface it as `text` for the seam to parse.
 *  - `tool`  → a single strict function tool whose parameters ARE the schema, with
 *    `tool_choice` forcing the call. The tool-call `arguments` (a JSON string) are
 *    parsed and returned as `toolInput`.
 *
 * Strict structured outputs require every object to set `additionalProperties:
 * false` and list every property in `required`. `zodToJsonSchema` does emit
 * `additionalProperties:false` for `z.object`, and we defensively re-apply both
 * constraints (`enforceStrict`) so optional/`.default()` fields don't break the
 * strict contract.
 *
 * Key comes from the unified config (OPENAI_API_KEY / NUXT_OPENAI_API_KEY /
 * stored settings). Model id is per-request.
 */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{ function?: { arguments?: string } }>
    }
  }>
  usage?: { prompt_tokens?: number, completion_tokens?: number }
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai'
  readonly model: string

  private readonly apiKey: string

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey
    this.model = model
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    const schema = enforceStrict(req.jsonSchema)
    const messages = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user }
    ]

    const body
      = req.mode === 'tool'
        ? {
            model: req.model || this.model,
            max_completion_tokens: req.maxTokens,
            messages,
            tools: [
              {
                type: 'function',
                function: {
                  name: sanitizeToolName(req.schemaName),
                  description: `Emit the result strictly matching the ${req.schemaName} schema.`,
                  strict: true,
                  parameters: schema
                }
              }
            ],
            tool_choice: {
              type: 'function',
              function: { name: sanitizeToolName(req.schemaName) }
            }
          }
        : {
            model: req.model || this.model,
            max_completion_tokens: req.maxTokens,
            messages,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: sanitizeToolName(req.schemaName),
                strict: true,
                schema
              }
            }
          }

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`OpenAI request failed (${res.status}): ${detail.slice(0, 300)}`)
    }

    const data = (await res.json()) as OpenAIChatResponse
    const usage: LLMResult['usage'] = data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined
    const message = data.choices?.[0]?.message

    if (req.mode === 'tool') {
      const args = message?.tool_calls?.[0]?.function?.arguments
      if (!args) throw new Error('OpenAI returned no tool call arguments')
      return { toolInput: JSON.parse(args), usage }
    }

    const content = message?.content ?? ''
    if (!content) throw new Error('OpenAI returned empty content')
    return { text: content, usage }
  }
}

/**
 * OpenAI strict mode requires every object node to set `additionalProperties:
 * false` and mark every property `required`. zod-to-json-schema mostly does this,
 * but `.optional()`/`.default()` produce non-required keys, so we re-apply both
 * recursively (and follow `$ref`-less `definitions`).
 */
function enforceStrict(schema: object): object {
  const clone = structuredClone(schema) as Record<string, unknown>
  walk(clone)
  return clone
}

function walk(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>

  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    obj.additionalProperties = false
    obj.required = Object.keys(obj.properties as Record<string, unknown>)
  }
  for (const value of Object.values(obj)) walk(value)
}

/** Function / schema names must match ^[a-zA-Z0-9_-]{1,64}$. */
function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'emit_result'
}
