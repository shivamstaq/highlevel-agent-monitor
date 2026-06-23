/**
 * Provider abstraction for the analysis engine (R2 unified interface).
 *
 * Every provider (Anthropic, OpenAI, Ollama, mock) accepts a system + user
 * prompt and a JSON Schema describing the required output shape, and returns a
 * unified envelope: the structured result (as `text` JSON for json-mode or
 * `toolInput` for tool-mode), plus token usage when the transport reports it.
 *
 * The `generateStructured` seam (server/services/llm/generateStructured.ts) is
 * the only thing that talks to this interface in R2: it derives the JSON Schema
 * from a `PromptSpec`, calls the active provider, then Zod-validates / guardrails
 * / repair-retries / falls back. Providers stay "dumb" — they perform transport
 * only and never validate.
 *
 * `generate(req)` is the SOLE provider entry point. The previous batch's
 * `complete()`/`LLMCompleteOptions` legacy shape has been removed (it had zero
 * callers — the whole eval path now goes through `generateStructured`).
 */

/** Token accounting, when the provider's transport reports it. */
export interface LLMUsage {
  input: number
  output: number
}

/** How the structured result is requested from the provider. */
export type LLMMode = 'json' | 'tool'

/**
 * Unified completion request. `jsonSchema` is a draft-07 JSON Schema (produced by
 * `zodToJsonSchema(spec.outputSchema, spec.schemaName)`); `schemaName` is the
 * stable, descriptive name used as the Anthropic/OpenAI tool name and the mock
 * registry discriminator. `model` and `maxTokens` are resolved by the seam from
 * `getLlmConfig()` + the `PromptSpec`. `mode` selects tool-calling vs native
 * json-schema structured output where the provider supports both.
 */
export interface LLMRequest {
  system: string
  user: string
  jsonSchema: object
  schemaName: string
  model: string
  maxTokens: number
  mode: LLMMode
}

/**
 * Unified completion envelope. Exactly one of `text` / `toolInput` is populated:
 *  - json mode  → `text` holds the raw JSON string the caller must parse.
 *  - tool mode  → `toolInput` holds the already-parsed tool input object.
 * `usage` is best-effort (omitted by transports that don't report tokens).
 */
export interface LLMResult {
  text?: string
  toolInput?: unknown
  usage?: LLMUsage
}

export interface LLMProvider {
  /** Provider identifier persisted on the Analysis (e.g. 'anthropic', 'openai', 'ollama', 'mock'). */
  readonly name: string
  /** Identifies the concrete default model (e.g. 'claude-sonnet-4-6', 'deterministic'). */
  readonly model: string

  /**
   * R2 unified structured completion — the entry point `generateStructured` uses.
   * Returns the unified `{ text?, toolInput?, usage? }` envelope.
   */
  generate(req: LLMRequest): Promise<LLMResult>
}
