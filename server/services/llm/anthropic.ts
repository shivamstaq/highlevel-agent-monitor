import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMRequest, LLMResult } from './types'

/**
 * Anthropic provider (per the claude-api skill).
 *
 * The installed SDK (@anthropic-ai/sdk 0.39) predates the `output_config.format`
 * structured-output parameter, so we obtain guaranteed schema-conforming JSON
 * the portable way: declare a single tool whose `input_schema` IS the required
 * output schema, then force the model to call it with `tool_choice`. The tool's
 * `input` is the structured result.
 *
 * R2 changes:
 *  - `generate(req)` is the unified entry point: per-request `model` + `maxTokens`
 *    (resolved by the seam from getLlmConfig + the PromptSpec), `mode` (tool|json),
 *    and a returned `usage` envelope.
 *  - Prompt caching: the stable system prefix is marked `cache_control` so the
 *    heavy agent-prompt/flow/vocabulary prefix is billed at cache-read rates and
 *    only the per-call transcript varies.
 *  - Haiku takes NO `effort`/`thinking` param — we never send one (the SDK's only
 *    typed thinking on-mode would 400 on Haiku 4.5 and on Opus/Sonnet here too).
 *
 * The model id and key come from the unified request / config layer.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'
  readonly model: string

  private readonly client: Anthropic

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    const toolName = sanitizeToolName(req.schemaName)

    const message = await this.client.messages.create({
      model: req.model || this.model,
      max_tokens: req.maxTokens,
      // Cache the stable system prefix (agent prompt / flow / vocabulary).
      system: [
        {
          type: 'text',
          text: req.system,
          cache_control: { type: 'ephemeral' }
        }
      ],
      tools: [
        {
          name: toolName,
          description: `Emit the result strictly matching the ${req.schemaName} schema.`,
          input_schema: req.jsonSchema as Anthropic.Tool.InputSchema
        }
      ],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: req.user }]
    })

    const usage: LLMResult['usage'] = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens
    }

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )
    if (!toolUse) {
      throw new Error('Anthropic returned no tool_use block')
    }
    return { toolInput: toolUse.input, usage }
  }
}

/** Tool names must match ^[a-zA-Z0-9_-]{1,64}$. */
function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'emit_result'
}
