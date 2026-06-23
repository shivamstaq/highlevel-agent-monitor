/**
 * generateStructured — the single structured-output seam (R2 / ADR §1.2).
 *
 * One entry point owns the whole lifecycle for any registered prompt:
 *   resolve spec → validate vars → derive JSON Schema (zodToJsonSchema) →
 *   pick model via modelForRole(spec.role) → call the active provider in the
 *   spec's tool/json mode → Zod-validate the result → run guardrails →
 *   repair-retry ONCE on any invalid result (MAX_ATTEMPTS=2) → else the spec's
 *   deterministic fallback (usedFallback:true).
 *
 * Providers stay dumb (transport only). The mock provider is short-circuited
 * straight to the deterministic fallback so the zero-cost / CI path is identical
 * to the pre-R2 deterministic output (no behaviour change this batch).
 *
 * Returns `{ data, meta }` where `meta` carries the active provider, model, the
 * prompt version, whether the fallback was used, and best-effort token usage —
 * everything needed to persist provenance on each Analysis (honesty requirement).
 */
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { LLMProvider, LLMResult, LLMUsage } from './types'
import { buildProvider } from './index'
import { getLlmConfig, modelForRole } from './config'
import { PROMPTS, type PromptId, type PromptVars, type PromptOutput } from './prompts/registry'
import type { PromptSpec } from './prompts/types'

/** 1 initial attempt + 1 repair attempt (ADR open-decision #3, confirmed 2). */
export const MAX_ATTEMPTS = 2

export interface GenerateMeta {
  provider: string
  model: string
  promptId: string
  promptVersion: string
  /** True when no LLM attempt produced a valid result and the fallback was used. */
  usedFallback: boolean
  /** Total token usage across attempts, when the provider reported it. */
  usage?: LLMUsage
}

export interface GenerateResult<O> {
  data: O
  meta: GenerateMeta
}

/**
 * Run a registered prompt and return a validated, guardrail-checked result.
 *
 * @param promptId  a key of the typed PROMPTS registry
 * @param vars      the prompt's input vars (type-checked against its inputSchema)
 */
export async function generateStructured<Id extends PromptId>(
  promptId: Id,
  vars: PromptVars<Id>
): Promise<GenerateResult<PromptOutput<Id>>> {
  // The registry's per-id generics don't survive the `keyof` index here, so we
  // operate on the spec through a locally-narrowed I/O view; every value still
  // flows through the spec's own Zod schemas, so this is type-safe at runtime.
  const spec = PROMPTS[promptId] as unknown as PromptSpec<PromptVars<Id>, PromptOutput<Id>>

  // Validate the input vars up front (caller contract).
  const parsedVars = spec.inputSchema.parse(vars) as PromptVars<Id>

  const cfg = await getLlmConfig()
  const model = modelForRole(cfg, spec.role)

  // buildProvider THROWS when a real cloud provider is selected but its key is
  // empty (no silent mock). Surface that loudly as a flagged fallback so the UI's
  // usedFallback honesty badge fires and meta.provider names the misconfiguration
  // — the caller never receives deterministic output presented as a real answer.
  let provider: LLMProvider
  try {
    provider = buildProvider(cfg)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[generateStructured] provider misconfigured: ${msg}`)
    return fallbackResult(spec, parsedVars, {
      provider: 'misconfigured',
      model,
      promptId: spec.id,
      promptVersion: spec.version
    })
  }

  const baseMeta: Omit<GenerateMeta, 'usedFallback' | 'usage'> = {
    provider: provider.name,
    model,
    promptId: spec.id,
    promptVersion: spec.version
  }

  // Mock (and any provider that resolved to mock) → deterministic fallback. This
  // keeps the zero-cost / CI path byte-identical to the pre-R2 output.
  if (provider.name === 'mock') {
    return fallbackResult(spec, parsedVars, { ...baseMeta, provider: provider.name })
  }

  // Derive a TOP-LEVEL object JSON Schema. NOTE: passing `spec.schemaName` as the
  // 2nd arg makes zod-to-json-schema emit a `$ref`/`definitions` envelope with no
  // top-level `type`, which Anthropic's `tools[].input_schema` rejects
  // (400 "input_schema.type: Field required"). We omit the name so the schema is
  // inlined as `{ type:'object', properties, ... }`; the stable name is still
  // carried separately via `spec.schemaName` (the tool name / mock discriminator).
  const jsonSchema = zodToJsonSchema(spec.outputSchema) as object
  const system = spec.system(parsedVars)
  const user = spec.user(parsedVars)

  let usage: LLMUsage | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await provider.generate({
        system,
        user: attempt === 1 ? user : repairUser(user),
        jsonSchema,
        schemaName: spec.schemaName,
        model,
        maxTokens: spec.maxTokens,
        mode: spec.mode
      })
      usage = mergeUsage(usage, res.usage)

      const candidate = extractCandidate(res)
      const parsed = spec.outputSchema.safeParse(candidate)
      if (!parsed.success) {
        // invalid shape → repair-retry / fallback. Surface WHY in Cloudflare logs.
        console.warn(`[generateStructured] ${spec.id} attempt ${attempt} produced invalid JSON shape: ${parsed.error.message}`)
        continue
      }
      const data = parsed.data as PromptOutput<Id>

      // Guardrails: a throw means reject this attempt.
      runGuardrails(spec, data, parsedVars)
      return { data, meta: { ...baseMeta, usedFallback: false, usage } }
    } catch (err) {
      // Transport error or guardrail rejection — try the repair turn, else fall
      // through to the deterministic fallback below. Log WHY so the silent fallback
      // is auditable (transport error vs guardrail rejection).
      console.warn(`[generateStructured] ${spec.id} attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.warn(`[generateStructured] ${spec.id} fell back: no valid result after ${MAX_ATTEMPTS} attempts`)
  return fallbackResult(spec, parsedVars, baseMeta, usage)
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** tool-mode → parsed toolInput; json-mode → parse the text payload. */
function extractCandidate(res: LLMResult): unknown {
  if (res.toolInput !== undefined) return res.toolInput
  if (typeof res.text === 'string') {
    try {
      return JSON.parse(res.text)
    } catch {
      return undefined
    }
  }
  return undefined
}

function runGuardrails<I, O>(spec: PromptSpec<I, O>, out: O, vars: I): void {
  for (const g of spec.guardrails ?? []) g(out, vars)
}

function fallbackResult<Id extends PromptId>(
  spec: PromptSpec<PromptVars<Id>, PromptOutput<Id>>,
  vars: PromptVars<Id>,
  baseMeta: Omit<GenerateMeta, 'usedFallback' | 'usage'>,
  usage?: LLMUsage
): GenerateResult<PromptOutput<Id>> {
  if (!spec.fallback) {
    throw new Error(`generateStructured: prompt '${spec.id}' produced no valid output and has no fallback`)
  }
  // Re-validate the fallback so it satisfies the same contract.
  const data = spec.outputSchema.parse(spec.fallback(vars)) as PromptOutput<Id>
  return { data, meta: { ...baseMeta, usedFallback: true, usage } }
}

/** Prepend a terse correction instruction for the repair turn. */
function repairUser(user: string): string {
  return [
    'Your previous response was rejected because it did not satisfy the required',
    'output schema and guardrails. Re-emit a corrected result that strictly matches',
    'the schema; cite real transcript entry indices where required.',
    '',
    user
  ].join('\n')
}

function mergeUsage(a: LLMUsage | undefined, b: LLMUsage | undefined): LLMUsage | undefined {
  if (!a) return b
  if (!b) return a
  return { input: a.input + b.input, output: a.output + b.output }
}

// Provider type is referenced indirectly via buildProvider's return.
export type { LLMProvider }
