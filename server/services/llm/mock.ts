// CREATED (our eval layer)
/**
 * Deterministic mock provider.
 *
 * Lets the whole app build, demo and end-to-end smoke-test with ZERO external
 * dependencies and ZERO cost — the user-mandated default when no key + provider
 * is set. It implements the `LLMProvider` contract and returns a plausible,
 * schema-shaped object keyed deterministically on `schemaName` (the prompt's
 * stable discriminator) so identical inputs always yield identical output (CI
 * stable).
 *
 * The `generateStructured` seam short-circuits the mock straight to each
 * PromptSpec's deterministic `fallback`, so this provider only needs to be cheap,
 * deterministic and well-typed — never authoritative.
 */
import type { LLMProvider, LLMRequest, LLMResult } from './types'

/** Registry of deterministic stubs, keyed by the stable schema/prompt name. */
const MOCK_REGISTRY: Record<string, unknown> = {
  // criteria.ts re-grounds this into the real spec-derived rubric.
  SuccessCriteria: { criteria: [] }
}

function mockFor(schemaName: string): unknown {
  return schemaName in MOCK_REGISTRY ? MOCK_REGISTRY[schemaName] : {}
}

export class MockProvider implements LLMProvider {
  readonly name = 'mock'
  readonly model = 'deterministic'

  async generate(req: LLMRequest): Promise<LLMResult> {
    const value = mockFor(req.schemaName)
    return { toolInput: value, text: JSON.stringify(value), usage: { input: 0, output: 0 } }
  }
}
