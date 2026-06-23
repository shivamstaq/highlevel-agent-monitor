/**
 * GET /api/settings — the analysis-engine config the Settings UI renders.
 *
 * Returns the EFFECTIVE LLM config (stored `settings:llm` merged OVER
 * runtimeConfig OVER cost-low defaults — see server/services/llm/config.ts), but
 * NEVER the secret key values. Keys are surfaced only as booleans
 * (`anthropicKeySet` / `openaiKeySet`) so the UI can show "Set" / "Not set"
 * without ever shipping a credential to the browser.
 *
 * `provider` / `reasonerModel` / `labelerModel` are the live, resolved values the
 * eval pipeline would use right now — what the operator can verify on screen.
 */
import { getLlmConfig } from '../services/llm/config'

export default defineEventHandler(async () => {
  const cfg = await getLlmConfig()
  return {
    provider: cfg.provider,
    reasonerModel: cfg.reasonerModel,
    labelerModel: cfg.labelerModel,
    ollamaBaseUrl: cfg.ollamaBaseUrl,
    ollamaModel: cfg.ollamaModel,
    // Write-only credentials: expose presence, never the value.
    anthropicKeySet: cfg.anthropicKey.length > 0,
    openaiKeySet: cfg.openaiKey.length > 0
  }
})
