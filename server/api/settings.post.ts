/**
 * POST /api/settings — persist the analysis-engine config to `settings:llm`.
 *
 * Body (all optional): { provider, reasonerModel, labelerModel, anthropicKey?,
 * openaiKey?, ollamaBaseUrl?, ollamaModel? }. This is the only write path for the
 * stored layer that getLlmConfig() merges OVER runtimeConfig OVER cost-low
 * defaults.
 *
 * Keys are WRITE-ONLY: an `anthropicKey` / `openaiKey` is persisted only when a
 * non-empty value is sent. A missing or empty key field leaves the previously
 * stored key untouched (we read-modify-write the existing object), so saving the
 * form without re-typing a key never clears it. Selection fields (provider /
 * models) are written through as given.
 *
 * Responds with the same NON-SECRET shape as GET /api/settings (presence
 * booleans, never the key values), reflecting the freshly resolved config.
 */
import { z } from 'zod'
import { getSetting, setSetting } from '../services/db'
import { getLlmConfig, type StoredLlmSettings } from '../services/llm/config'

const BodySchema = z
  .object({
    provider: z.enum(['mock', 'anthropic', 'openai', 'ollama']).optional(),
    reasonerModel: z.string().optional(),
    labelerModel: z.string().optional(),
    anthropicKey: z.string().optional(),
    openaiKey: z.string().optional(),
    ollamaBaseUrl: z.string().optional(),
    ollamaModel: z.string().optional()
  })
  .partial()

const SETTINGS_KEY = 'llm'

/** Trim then treat blank as "not provided" (so empty inputs never clear a key). */
function nonEmpty(v: string | undefined): string | undefined {
  const t = typeof v === 'string' ? v.trim() : ''
  return t.length > 0 ? t : undefined
}

export default defineEventHandler(async (event) => {
  const raw = await readBody(event).catch(() => ({}))
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid settings payload' })
  }
  const body = parsed.data

  // Read-modify-write so write-only keys persist across saves.
  const existing = ((await getSetting<StoredLlmSettings>(SETTINGS_KEY)) ?? {})

  const next: StoredLlmSettings = { ...existing }

  if (body.provider !== undefined) next.provider = body.provider
  if (body.reasonerModel !== undefined) next.reasonerModel = body.reasonerModel
  if (body.labelerModel !== undefined) next.labelerModel = body.labelerModel
  if (body.ollamaBaseUrl !== undefined) next.ollamaBaseUrl = body.ollamaBaseUrl
  if (body.ollamaModel !== undefined) next.ollamaModel = body.ollamaModel

  // Keys: only overwrite when a non-empty value is supplied.
  const nextAnthropic = nonEmpty(body.anthropicKey)
  if (nextAnthropic) next.anthropicKey = nextAnthropic
  const nextOpenai = nonEmpty(body.openaiKey)
  if (nextOpenai) next.openaiKey = nextOpenai

  await setSetting(SETTINGS_KEY, next)

  // Reflect the freshly resolved config — non-secret shape only.
  const cfg = await getLlmConfig()
  return {
    provider: cfg.provider,
    reasonerModel: cfg.reasonerModel,
    labelerModel: cfg.labelerModel,
    ollamaBaseUrl: cfg.ollamaBaseUrl,
    ollamaModel: cfg.ollamaModel,
    anthropicKeySet: cfg.anthropicKey.length > 0,
    openaiKeySet: cfg.openaiKey.length > 0
  }
})
