/**
 * LLM configuration resolver (R2).
 *
 * Merges three layers, highest-priority first:
 *   1. STORED settings  — the Settings UI's `settings:llm` object (provider +
 *      per-role models + write-only API keys), persisted via db.ts.
 *   2. runtimeConfig    — env-derived (`LLM_PROVIDER`, `ANTHROPIC_API_KEY`,
 *      `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, …) from nuxt.config.ts.
 *   3. COST-LOW defaults — the user-mandated zero-cost floor: provider `mock`,
 *      reasoner `claude-sonnet-4-6`, labeler `claude-haiku-4-5`. The default
 *      provider stays `mock` (zero spend) until a key + provider is set.
 *
 * `modelForRole(role)` picks the reasoner vs labeler model. Mock/Ollama ignore
 * the model id for billing but the seam still threads it through for honesty
 * (persisted on each Analysis as the active model).
 */
import { z } from 'zod'
import { getSetting } from '../db'

/**
 * Cost-low defaults (user mandate, 2026-06-22).
 *
 * `provider: 'mock'` is the no-config-at-all floor — the deliberate zero-spend
 * baseline when NOTHING (no stored setting, no env) selects a provider. It is
 * HONEST, not a silent downgrade: it only applies when nobody chose a real
 * provider, and every resulting answer is stamped usedFallback / provider='mock'
 * so the UI's honesty badge shows the deterministic path. Crucially, an
 * explicitly-selected anthropic/openai with an EMPTY key does NOT land here — it
 * throws in buildProvider (no silent mock for a misconfigured real provider).
 */
export const COST_LOW_DEFAULTS = {
  provider: 'mock',
  reasonerModel: 'claude-sonnet-4-6',
  labelerModel: 'claude-haiku-4-5'
} as const

export type LlmProviderId = 'mock' | 'anthropic' | 'openai' | 'ollama'
export type LlmRole = 'reasoner' | 'labeler'

export interface LlmConfig {
  provider: LlmProviderId
  anthropicKey: string
  openaiKey: string
  reasonerModel: string
  labelerModel: string
  /** Ollama transport coordinates (local provider). */
  ollamaBaseUrl: string
  ollamaModel: string
}

/** Shape of the persisted `settings:llm` object (all fields optional). */
const StoredSettingsSchema = z
  .object({
    provider: z.enum(['mock', 'anthropic', 'openai', 'ollama']).optional(),
    anthropicKey: z.string().optional(),
    openaiKey: z.string().optional(),
    reasonerModel: z.string().optional(),
    labelerModel: z.string().optional(),
    ollamaBaseUrl: z.string().optional(),
    ollamaModel: z.string().optional()
  })
  .partial()
export type StoredLlmSettings = z.infer<typeof StoredSettingsSchema>

/** Settings-UI storage key (within the `data` namespace's `settings:` prefix). */
const SETTINGS_KEY = 'llm'

function firstNonEmpty(...vals: Array<string | undefined>): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return ''
}

/**
 * Resolve the effective LLM configuration (stored OVER runtimeConfig OVER
 * cost-low defaults). Reads `settings:llm` from storage; missing/invalid stored
 * settings are ignored (treated as empty), never throwing.
 */
export async function getLlmConfig(): Promise<LlmConfig> {
  const rc = useRuntimeConfig()

  let stored: StoredLlmSettings = {}
  try {
    const raw = await getSetting(SETTINGS_KEY)
    if (raw) {
      const parsed = StoredSettingsSchema.safeParse(raw)
      if (parsed.success) stored = parsed.data
    }
  } catch {
    // Storage unavailable (e.g. pre-mount) — fall through to env + defaults.
  }

  const envProvider = (rc.llmProvider as string) || ''
  const provider = (stored.provider
    ?? (isProviderId(envProvider) ? envProvider : undefined)
    ?? COST_LOW_DEFAULTS.provider) as LlmProviderId

  // Make the zero-cost floor visible to operators: if nothing selected a real
  // provider and we resolved to the mock default, log it once so a "why is this
  // deterministic?" question has an audit trail (the UI also shows the badge).
  if (provider === 'mock') {
    console.info('[getLlmConfig] resolved provider=mock (zero-cost deterministic floor — no real provider configured)')
  }

  return {
    provider,
    anthropicKey: firstNonEmpty(stored.anthropicKey, rc.anthropicApiKey as string),
    openaiKey: firstNonEmpty(stored.openaiKey, rc.openaiApiKey as string),
    // Cost-low mandate: the reasoner default (Sonnet) wins UNLESS a model is
    // EXPLICITLY set in stored settings. runtimeConfig.anthropicModel (Opus
    // default) must NOT override the per-role cost-low floor, so it is excluded
    // from this chain.
    reasonerModel: firstNonEmpty(
      stored.reasonerModel,
      COST_LOW_DEFAULTS.reasonerModel
    ),
    labelerModel: firstNonEmpty(stored.labelerModel, COST_LOW_DEFAULTS.labelerModel),
    ollamaBaseUrl: firstNonEmpty(stored.ollamaBaseUrl, rc.ollamaBaseUrl as string, 'http://localhost:11434'),
    ollamaModel: firstNonEmpty(stored.ollamaModel, rc.ollamaModel as string, 'qwen2.5:14b')
  }
}

/** Pick the model id for a role from a resolved config. */
export function modelForRole(cfg: LlmConfig, role: LlmRole): string {
  return role === 'labeler' ? cfg.labelerModel : cfg.reasonerModel
}

function isProviderId(v: string): v is LlmProviderId {
  return v === 'mock' || v === 'anthropic' || v === 'openai' || v === 'ollama'
}
