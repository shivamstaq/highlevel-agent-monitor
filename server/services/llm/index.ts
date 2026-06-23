import type { LLMProvider } from './types'
import { OllamaProvider } from './ollama'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { MockProvider } from './mock'
import type { LlmConfig } from './config'

export type { LLMProvider, LLMRequest, LLMResult, LLMUsage, LLMMode } from './types'
export { getLlmConfig, modelForRole, COST_LOW_DEFAULTS } from './config'
export type { LlmConfig, LlmRole, LlmProviderId } from './config'

/**
 * Build the active provider from a resolved LlmConfig (the single R2 selector
 * used by generateStructured).
 *
 * HONESTY MANDATE (no silent mock): a real cloud provider that is *selected* but
 * unconfigured must FAIL LOUD, never silently degrade to deterministic output
 * dressed up as a real answer. So when `provider` is explicitly 'anthropic' or
 * 'openai' and its API key is empty, we THROW — generateStructured catches this
 * and surfaces meta.provider='misconfigured' / usedFallback=true so the UI's
 * honesty badge fires. The ONLY way to get a MockProvider is to choose 'mock'
 * explicitly (a deliberate, labeled zero-cost path). Ollama is left to the seam:
 * its transport failures are recoverable (repair-retry → flagged fallback).
 */
export function buildProvider(cfg: LlmConfig): LLMProvider {
  switch (cfg.provider) {
    case 'anthropic':
      if (!cfg.anthropicKey) {
        throw new Error(
          'LLM provider "anthropic" selected but NUXT_ANTHROPIC_API_KEY is empty — '
          + 'refusing to silently fall back to mock'
        )
      }
      return new AnthropicProvider(cfg.anthropicKey, cfg.reasonerModel)
    case 'openai':
      if (!cfg.openaiKey) {
        throw new Error(
          'LLM provider "openai" selected but NUXT_OPENAI_API_KEY is empty — '
          + 'refusing to silently fall back to mock'
        )
      }
      return new OpenAIProvider(cfg.openaiKey, cfg.reasonerModel)
    case 'ollama':
      return new OllamaProvider(cfg.ollamaBaseUrl, cfg.ollamaModel)
    case 'mock':
    default:
      // Explicit, labeled zero-cost path only — never an implicit downgrade.
      return new MockProvider()
  }
}
