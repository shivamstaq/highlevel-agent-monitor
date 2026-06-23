// BORROWED (mirrors GHL)
/**
 * POST /api/webhooks/ghl — receive GoHighLevel Voice AI call-end / transcript
 * webhooks and ingest the call + transcript (real-time push path; the poll
 * `/api/sync` is the backfill — dedupe is by call id across both).
 *
 * The exact webhook envelope was NOT captured in phase 1, so this handler is
 * deliberately SHAPE-TOLERANT once authenticity is established: it unwraps the
 * call-log from any of the envelopes GHL is known to use and validates with the
 * same lenient `GhlCallLogSchema` the poll path uses.
 *
 * AUTHENTICITY (FAIL-CLOSED — see server/utils/ghlWebhook.ts):
 *   - GHL marketplace webhooks are signed with GHL's ASYMMETRIC private key. We
 *     verify with GHL's PUBLISHED PUBLIC key: `X-GHL-Signature` (Ed25519, current)
 *     or `X-WH-Signature` (RSA-SHA256, legacy → removed 2026-07-01).
 *   - The verify runs over the EXACT raw body bytes (readRawBody), NOT the
 *     re-serialized JSON.
 *   - A missing or invalid signature returns 401 with NO side effects (nothing
 *     ingested, nothing analyzed). This is a genuine reversal of the old HMAC
 *     check, which could never match a real GHL signature.
 *   - For the UNSIGNED route (GHL Workflow webhook actions carry no signature),
 *     no public key is configured; instead a shared `?token=` query gate is
 *     required and checked. If neither a key nor a token gate is configured the
 *     endpoint is UNAUTHENTICATED and rejects (fail-closed) rather than ingesting
 *     blindly.
 */
import { GhlCallLogSchema, type GhlCallLog } from '#shared/ghl'
import { mapCallLog, computePerTurnLatency } from '../../services/ghl'
import { upsertCall, upsertTranscript, upsertTimeline, getAgent, getCall, getTranscript } from '../../services/db'
import { analyzeCall } from '../../services/eval/analysis'
import {
  verifyGhlWebhook,
  safeTokenEqual,
  GHL_DEFAULT_ED25519_PUBKEY_PEM,
  type GhlWebhookKeys
} from '../../utils/ghlWebhook'

/** Pull the call-log object out of whatever envelope the webhook arrives in. */
function extractCallLog(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  for (const key of ['callLog', 'call', 'data', 'payload', 'object', 'voiceAiCall', 'voice_ai_call']) {
    const v = obj[key]
    if (v && typeof v === 'object') return v
  }
  // The payload itself may already be the call-log.
  if ('id' in obj || 'transcriptWithToolCalls' in obj || 'transcript' in obj || 'agentId' in obj) {
    return obj
  }
  return null
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as Record<string, string>

  // Public keys are NON-SECRET. Default the Ed25519 key to GHL's published one
  // so signed marketplace webhooks work out of the box; allow env override for
  // key rotation. The legacy RSA key has no safe default (long, may rotate) — it
  // is opt-in via env.
  const keys: GhlWebhookKeys = {
    ed25519PubKeyPem: config.ghlWebhookEd25519PubKey || GHL_DEFAULT_ED25519_PUBKEY_PEM,
    rsaPubKeyPem: config.ghlWebhookRsaPubKey || ''
  }
  const hasSigningKey = Boolean(keys.ed25519PubKeyPem || keys.rsaPubKeyPem)

  // Unsigned-route gate (GHL Workflow webhook actions carry no signature).
  const expectedToken = config.ghlWebhookToken || ''

  // Read the RAW body so verification is over the exact bytes GHL signed.
  const rawBuf = await readRawBody(event, false).catch(() => null) as Buffer | null
  const rawBytes: Buffer = Buffer.isBuffer(rawBuf)
    ? rawBuf
    : Buffer.from(typeof rawBuf === 'string' ? rawBuf : '', 'utf8')

  // ── FAIL-CLOSED AUTHENTICATION ────────────────────────────────────────────
  const ghlSig = getHeader(event, 'x-ghl-signature')
  const whSig = getHeader(event, 'x-wh-signature')
  const hasSignature = Boolean(ghlSig || whSig)

  if (hasSignature) {
    // Signed marketplace webhook → verify with the public key (fail-closed).
    const outcome = verifyGhlWebhook(
      rawBytes,
      { ghlSignature: ghlSig, whSignature: whSig },
      keys,
      () => console.warn('[webhooks/ghl] verified via LEGACY x-wh-signature (RSA-SHA256) — GHL deprecates this scheme on 2026-07-01; migrate to x-ghl-signature (Ed25519).')
    )
    if (!outcome.ok) {
      console.warn(`[webhooks/ghl] rejected signed request: ${outcome.reason}`)
      // No side effects. 401 so the caller knows verification failed.
      setResponseStatus(event, 401)
      return { ok: false, error: 'invalid-signature' }
    }
  } else if (expectedToken) {
    // Unsigned route → require the shared ?token= gate (fail-closed).
    const provided = getQuery(event).token
    const token = typeof provided === 'string' ? provided : ''
    if (!token || !safeTokenEqual(token, expectedToken)) {
      console.warn('[webhooks/ghl] rejected unsigned request: missing/invalid ?token gate')
      setResponseStatus(event, 401)
      return { ok: false, error: 'invalid-token' }
    }
  } else {
    // Neither a signature on the request, nor a token gate configured. If a
    // signing key IS configured we expected a signature and got none → reject.
    // If NOTHING is configured the endpoint is unauthenticated → reject rather
    // than ingest blind. Either way: fail-closed.
    console.warn(
      hasSigningKey
        ? '[webhooks/ghl] rejected: signing key configured but request carried no signature'
        : '[webhooks/ghl] rejected: endpoint has no auth configured (set NUXT_GHL_WEBHOOK_ED25519_PUBKEY for signed marketplace webhooks, or NUXT_GHL_WEBHOOK_TOKEN + ?token= for the unsigned Workflow route)'
    )
    setResponseStatus(event, 401)
    return { ok: false, error: 'unauthenticated' }
  }
  // ── authenticated past this point ───────────────────────────────────────────

  let payload: unknown
  try {
    payload = rawBytes.length ? JSON.parse(rawBytes.toString('utf8')) : null
  } catch {
    return { ok: true, ignored: 'unparseable' }
  }

  const rawLog = extractCallLog(payload)
  if (!rawLog) return { ok: true, ignored: 'no-call-log' }

  // Validate with the lenient borrowed schema; a partial webhook shape that
  // can't even produce an id is acknowledged and dropped.
  const parsed = GhlCallLogSchema.safeParse(rawLog)
  if (!parsed.success || !parsed.data.id) {
    return { ok: true, ignored: 'invalid-shape' }
  }
  const log: GhlCallLog = parsed.data

  try {
    const { call, transcript } = mapCallLog(log, 'webhook')
    await upsertCall(call)
    await upsertTranscript(transcript)

    // Persist the REAL per-turn latency headline (same as the poll path).
    const perTurn = computePerTurnLatency(transcript.entries)
    if (perTurn.length > 0) {
      const avgResponseLatencyMs = Math.round(
        perTurn.reduce((s, p) => s + p.latencyMs, 0) / perTurn.length
      )
      const totalSec = transcript.entries.reduce(
        (m, e) => Math.max(m, e.role === 'action' ? e.atSec : e.endSec),
        0
      )
      await upsertTimeline({
        callId: call.id,
        source: 'partial-real',
        avgResponseLatencyMs,
        perTurnLatency: perTurn,
        events: [],
        interruptionCount: 0,
        totalMs: Math.round(totalSec * 1000)
      })
    }

    // Best-effort analysis (M3 eval layer). Never fails the webhook ACK.
    await triggerAnalysis(call.id).catch((err) => {
      console.warn(`[webhooks/ghl] analysis failed for call ${call.id}:`, err)
    })
  } catch (err) {
    // Malformed beyond the schema's tolerance — acknowledge so GHL doesn't retry.
    console.warn('[webhooks/ghl] map/ingest failed:', err)
    return { ok: true, ignored: 'map-failed' }
  }

  return { ok: true }
})

/**
 * Best-effort analysis trigger (M3 eval layer). Loads the call's enriched agent +
 * normalized transcript and drives the eval pipeline. Fully guarded by the caller.
 */
async function triggerAnalysis(callId: string): Promise<void> {
  const call = await getCall(callId)
  if (!call) return
  const [agent, transcript] = await Promise.all([
    getAgent(call.agentId),
    getTranscript(callId)
  ])
  if (!agent || !transcript) return

  await analyzeCall(agent, transcript)
}
