/**
 * Provider abstraction for the analysis engine.
 *
 * Every provider (Ollama, Anthropic, mock) takes a system + user prompt and a
 * JSON Schema describing the required output shape, and returns the parsed JSON
 * (still `unknown` until the caller validates it with zod). This keeps the
 * analysis pipeline provider-agnostic — `analysis.ts` and `criteria.ts` only
 * ever talk to this interface.
 */
export interface LLMCompleteOptions {
  /** System prompt — role definition, rubric, output contract. */
  system: string
  /** User prompt — the concrete task (agent + transcript, or goal/script). */
  user: string
  /** JSON Schema (draft-07 via zod-to-json-schema) the output must satisfy. */
  schema: object
  /** A stable, descriptive name for the schema (used as the tool name for Anthropic). */
  schemaName: string
}

export interface LLMProvider {
  /** Provider identifier persisted on the Analysis (e.g. 'anthropic', 'ollama', 'mock'). */
  readonly name: string
  /** Identifies the concrete model used (e.g. 'claude-opus-4-8', 'qwen2.5:14b', 'deterministic'). */
  readonly model: string
  /** Run a single structured completion. Returns parsed JSON (unverified). */
  complete(opts: LLMCompleteOptions): Promise<unknown>
}
