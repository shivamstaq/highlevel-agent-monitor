import Anthropic from '@anthropic-ai/sdk'
import type { LLMCompleteOptions, LLMProvider } from './types'

/**
 * Anthropic provider (per the claude-api skill).
 *
 * The installed SDK (@anthropic-ai/sdk 0.39) predates the `output_config.format`
 * structured-output parameter, so we obtain guaranteed schema-conforming JSON
 * the portable way: declare a single tool whose `input_schema` IS the required
 * output schema, then force the model to call it with `tool_choice`. The tool's
 * `input` is the structured result.
 *
 * Model id comes from runtimeConfig.anthropicModel (default 'claude-opus-4-8').
 * For Opus 4.8 the `thinking` parameter is omitted entirely — the model accepts
 * that, and `thinking: {type:"enabled", budget_tokens}` (the only on-mode this
 * SDK version types) would be rejected with a 400.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'
  readonly model: string

  private readonly client: Anthropic

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async complete(opts: LLMCompleteOptions): Promise<unknown> {
    const toolName = sanitizeToolName(opts.schemaName)

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: opts.system,
      tools: [
        {
          name: toolName,
          description: `Emit the result strictly matching the ${opts.schemaName} schema.`,
          input_schema: opts.schema as Anthropic.Tool.InputSchema
        }
      ],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: opts.user }]
    })

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )
    if (!toolUse) {
      throw new Error('Anthropic returned no tool_use block')
    }
    return toolUse.input
  }
}

/** Tool names must match ^[a-zA-Z0-9_-]{1,64}$. */
function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'emit_result'
}
