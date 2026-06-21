/**
 * POST /api/webhooks/ghl — receive GoHighLevel Voice AI webhooks
 * (call-completed / transcript-generated), upsert the call + transcript, then
 * best-effort trigger analysis.
 *
 * GHL wraps webhook payloads in a few different envelopes depending on event
 * type, so we extract defensively and never throw back at GHL (always 200 ok)
 * to avoid the platform disabling the subscription on transient failures.
 */
import { mapCallLogToCall, mapCallLogToTranscript, type GhlCallLog } from '../../services/ghl'
import { upsertCall, upsertTranscript } from '../../services/db'
import { analyzeCall } from '../../services/analysis'

/** Unwrap the call-log object from whatever the webhook envelope is. */
function extractCallLog(payload: unknown): GhlCallLog | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  for (const key of ['callLog', 'call', 'data', 'payload', 'object', 'voiceAiCall']) {
    const v = obj[key]
    if (v && typeof v === 'object') return v as GhlCallLog
  }
  // The payload itself may already be the call-log.
  if ('transcript' in obj || 'callId' in obj || 'id' in obj || 'messages' in obj) {
    return obj as GhlCallLog
  }
  return null
}

export default defineEventHandler(async (event) => {
  const payload = await readBody<unknown>(event).catch(() => null)
  const log = extractCallLog(payload)

  if (!log) {
    return { ok: true, ignored: true }
  }

  let callId: string | undefined
  try {
    const call = mapCallLogToCall(log, 'webhook')
    callId = call.id
    if (call.id) await upsertCall(call)

    const transcript = mapCallLogToTranscript(log)
    if (transcript.turns.length > 0) {
      await upsertTranscript(transcript)
    }
  } catch {
    // Malformed payload — acknowledge so GHL doesn't retry-storm.
    return { ok: true, ignored: true }
  }

  // Best-effort analysis trigger. The analysis service is owned by the llm slice;
  // wrap in try/catch so a missing provider / transcript never fails the webhook.
  if (callId) {
    try {
      await analyzeCall(callId)
    } catch {
      // Analysis is non-critical to ingestion; swallow.
    }
  }

  return { ok: true }
})
