/**
 * PromptSpec — the single self-describing unit of the centralized, versioned
 * prompts directory (R2 requirement #3 / ADR §1.3).
 *
 * One `PromptSpec<I,O>` fully owns a prompt: its stable `id` + `version`, the
 * `role` that picks reasoner-vs-labeler model, the input/output Zod contracts,
 * the `system`/`user` template builders, optional `guardrails` (run after Zod
 * validation; throw to trigger a repair-retry), an optional deterministic
 * `fallback` (used when every LLM attempt fails — keeps the pipeline working at
 * zero cost), and a `maxTokens` cap.
 *
 * Specs are assembled into a typed `PROMPTS` registry (registry.ts) so every call
 * site is type-safe on the prompt id, its vars, and its output.
 */
import type { z } from 'zod'

export type PromptRole = 'reasoner' | 'labeler'
export type PromptMode = 'json' | 'tool'

/**
 * A guardrail validates a (already Zod-parsed) output against the input vars.
 * THROW to reject — the seam treats a throw as an invalid attempt and either
 * repair-retries (within MAX_ATTEMPTS) or falls back. Guardrails make invented /
 * uncited output structurally impossible to persist (e.g. evidence-must-be-a-
 * substring, closed-set enforcement).
 */
export type Guardrail<I, O> = (out: O, vars: I) => void

export interface PromptSpec<I, O> {
  /** Stable identifier (also the registry key). */
  id: string
  /** Bump on any system/user/schema change — persisted on each Analysis for diff-ability. */
  version: string
  /** Selects the model tier via modelForRole(). */
  role: PromptRole
  /** Provider transport for this prompt's structured output. */
  mode: PromptMode
  /** Zod contract for the template vars (parsed-output type is `I`; input is loose). */
  inputSchema: z.ZodType<I, z.ZodTypeDef, unknown>
  /** Zod contract the provider output must satisfy (parsed-output type is `O`). */
  outputSchema: z.ZodType<O, z.ZodTypeDef, unknown>
  /** Stable schema name handed to the provider (Anthropic/OpenAI tool name, mock key). */
  schemaName: string
  /** Build the system prompt from validated vars. */
  system: (vars: I) => string
  /** Build the user prompt from validated vars. */
  user: (vars: I) => string
  /** Post-validation invariants; throw to reject an attempt. */
  guardrails?: Guardrail<I, O>[]
  /** Deterministic last resort when every LLM attempt fails. */
  fallback?: (vars: I) => O
  /** Per-prompt output token cap (cost control). */
  maxTokens: number
}

/** Convenience helper that preserves the I/O generics at definition sites. */
export function definePrompt<I, O>(spec: PromptSpec<I, O>): PromptSpec<I, O> {
  return spec
}
