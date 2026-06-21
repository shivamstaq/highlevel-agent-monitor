/**
 * POST /api/sync — poll GHL Voice AI call-logs via the configured PIT and ingest
 * new calls + transcripts into storage.
 *
 * Body: { locationId?: string }. Falls back to runtimeConfig if omitted.
 * Degrades gracefully: with no PIT token configured it returns a structured
 * error instead of throwing, so the dashboard's "Sync" button never 500s.
 */
import { createGhlClient, mapCallLogToCall, mapCallLogToTranscript } from '../services/ghl'
import { upsertCall, upsertTranscript, upsertTimeline } from '../services/db'
import { buildTimelineFromSentences } from '../services/timeline'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const body = await readBody<{ locationId?: string }>(event).catch(() => ({} as { locationId?: string }))
  const locationId = body?.locationId || (config as Record<string, string>).ghlLocationId || ''

  if (!config.ghlPitToken) {
    return { ingested: 0, errors: ['GHL_PIT_TOKEN not set'] }
  }
  if (!locationId) {
    return { ingested: 0, errors: ['locationId required (body.locationId)'] }
  }

  const client = createGhlClient({ apiBase: config.ghlApiBase, pitToken: config.ghlPitToken })
  const errors: string[] = []
  let ingested = 0

  try {
    const logs = await client.listCallLogs(locationId, { limit: 100 })
    for (const log of logs) {
      try {
        const call = mapCallLogToCall(log, 'poll')
        // Skip records that produced no usable id.
        if (!call.id) continue
        await upsertCall(call)

        const transcript = mapCallLogToTranscript(log)
        if (transcript.turns.length > 0) {
          await upsertTranscript(transcript)
        }

        // Real timing path: if the call log carries a messageId, pull the
        // per-sentence transcription (real start/end ms) and persist an
        // `ingested` timeline. Best-effort — never blocks call ingestion.
        const messageId = String(log.messageId ?? '').trim()
        if (messageId) {
          try {
            const sentences = await client.getMessageTranscription(locationId, messageId)
            if (sentences.length > 0) {
              await upsertTimeline(buildTimelineFromSentences(call.id, sentences))
            }
          } catch (err) {
            errors.push(`transcription fetch failed for ${call.id}: ${(err as Error).message}`)
          }
        }
        ingested++
      } catch (err) {
        errors.push(`map/store failed for ${log.id ?? log.callId ?? 'unknown'}: ${(err as Error).message}`)
      }
    }
  } catch (err) {
    errors.push((err as Error).message)
  }

  return errors.length > 0 ? { ingested, errors } : { ingested }
})
