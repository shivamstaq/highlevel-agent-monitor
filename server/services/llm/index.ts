import type { LLMProvider } from './types'
import { OllamaProvider } from './ollama'
import { AnthropicProvider } from './anthropic'
import { MockProvider } from './mock'

export type { LLMProvider, LLMCompleteOptions } from './types'

/**
 * Select the active LLM provider from runtimeConfig.llmProvider, falling back to
 * the deterministic mock whenever the chosen provider's prerequisites are
 * missing (no API key, or an unreachable Ollama server) so the app always works.
 */
export async function getProvider(): Promise<LLMProvider> {
  const config = useRuntimeConfig()
  const choice = (config.llmProvider as string) || 'mock'

  if (choice === 'anthropic') {
    if (config.anthropicApiKey) {
      return new AnthropicProvider(config.anthropicApiKey as string, config.anthropicModel as string)
    }
    return new MockProvider()
  }

  if (choice === 'ollama') {
    const ollama = new OllamaProvider(config.ollamaBaseUrl as string, config.ollamaModel as string)
    if (await ollama.isReachable()) {
      return ollama
    }
    return new MockProvider()
  }

  return new MockProvider()
}
