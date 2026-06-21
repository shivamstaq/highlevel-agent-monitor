/**
 * PIT-authenticated GoHighLevel REST client for the Voice AI dashboard.
 *
 * Auth: Private Integration Token (PIT) as a Bearer token, plus the required
 * `Version` header. See https://highlevel.stoplight.io — the Voice AI call-log
 * endpoints live under `/voice-ai/dashboard/call-logs`. Field names below are
 * best-effort: the exact GHL response shape should be verified in-sandbox, so
 * the mappers are deliberately defensive about alternative key names.
 */
import type { Call, Transcript, Turn, Speaker } from '#shared/types'
import { CallSchema, TranscriptSchema } from '#shared/types'
import type { TranscriptionSentence } from './timeline'

const GHL_API_VERSION = '2021-07-28'

export interface GhlClientConfig {
  apiBase: string
  pitToken: string
}

/** Loose shape of a GHL Voice AI call-log record (keys vary across versions). */
export interface GhlCallLog {
  id?: string
  callId?: string
  _id?: string
  locationId?: string
  agentId?: string
  assistantId?: string
  aiAgentId?: string
  direction?: string
  callDirection?: string
  duration?: number
  durationSec?: number
  callDuration?: number
  outcome?: string
  status?: string
  disposition?: string
  recordingUrl?: string
  recording?: string
  contactName?: string
  contact?: { name?: string, fullName?: string, firstName?: string, lastName?: string }
  startedAt?: string
  startTime?: string
  createdAt?: string
  dateAdded?: string
  transcript?: unknown
  messages?: unknown
  transcription?: unknown
  [k: string]: unknown
}

function authHeaders(cfg: GhlClientConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.pitToken}`,
    Version: GHL_API_VERSION,
    Accept: 'application/json'
  }
}

/**
 * Thin fetch wrapper. Throws on non-2xx so callers (sync route) can collect the
 * error string; never swallows here so the failure is visible upstream.
 */
async function ghlFetch<T>(cfg: GhlClientConfig, path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, cfg.apiBase.replace(/\/$/, '') + '/')
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { headers: authHeaders(cfg) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GHL ${res.status} ${res.statusText} for ${path}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
  return res.json() as Promise<T>
}

export function createGhlClient(cfg: GhlClientConfig) {
  return {
    /** List Voice AI call logs for a location. */
    async listCallLogs(locationId: string, params?: { limit?: number, startAfter?: string }): Promise<GhlCallLog[]> {
      const data = await ghlFetch<unknown>(cfg, 'voice-ai/dashboard/call-logs', {
        locationId,
        limit: params?.limit,
        startAfter: params?.startAfter
      })
      return extractCallLogArray(data)
    },

    /** Fetch a single call log (with full transcript) by id. */
    async getCallLog(locationId: string, callId: string): Promise<GhlCallLog | null> {
      const data = await ghlFetch<unknown>(cfg, `voice-ai/dashboard/call-logs/${encodeURIComponent(callId)}`, { locationId })
      if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>
        const single = (obj.callLog ?? obj.call ?? obj.data ?? obj) as GhlCallLog
        return single ?? null
      }
      return null
    },

    /**
     * Fetch the per-sentence recording transcription for a message. This is the
     * ONE HighLevel source of REAL turn timing (startTime/endTime in ms) and ASR
     * confidence, used to build an `ingested` timeline (vs the modeled default).
     * Endpoint: GET /conversations/locations/:locationId/messages/:messageId/transcription
     */
    async getMessageTranscription(locationId: string, messageId: string): Promise<TranscriptionSentence[]> {
      const data = await ghlFetch<unknown>(
        cfg,
        `conversations/locations/${encodeURIComponent(locationId)}/messages/${encodeURIComponent(messageId)}/transcription`
      )
      return mapTranscription(data)
    }
  }
}

/** Map HighLevel's per-sentence transcription payload into timeline input. */
export function mapTranscription(data: unknown): TranscriptionSentence[] {
  const arr = Array.isArray(data)
    ? data
    : (data && typeof data === 'object'
        ? (((data as Record<string, unknown>).transcriptions
          ?? (data as Record<string, unknown>).sentences
          ?? (data as Record<string, unknown>).data) as unknown[] | undefined) ?? []
        : [])
  const out: TranscriptionSentence[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const start = Number(o.startTime ?? o.start ?? o.startMs ?? o.startTimeMs)
    const end = Number(o.endTime ?? o.end ?? o.endMs ?? o.endTimeMs)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const channel = Number(o.mediaChannel ?? o.channel ?? 0) || 0
    const confidenceRaw = Number(o.confidence)
    out.push({
      startTimeMs: start,
      endTimeMs: end,
      channel,
      text: String(o.transcript ?? o.text ?? ''),
      ...(Number.isFinite(confidenceRaw) ? { confidence: confidenceRaw } : {})
    })
  }
  return out
}

export type GhlClient = ReturnType<typeof createGhlClient>

/** Pull the call-log array out of whatever envelope GHL wraps it in. */
export function extractCallLogArray(data: unknown): GhlCallLog[] {
  if (Array.isArray(data)) return data as GhlCallLog[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['callLogs', 'calls', 'data', 'logs', 'items', 'records']) {
      const v = obj[key]
      if (Array.isArray(v)) return v as GhlCallLog[]
    }
  }
  return []
}

/* ----------------------------------------------------------------------------
 * Mappers: GHL call-log -> our domain types. Defensive about field names.
 * ------------------------------------------------------------------------- */

function pickCallId(log: GhlCallLog): string {
  return String(log.id ?? log.callId ?? log._id ?? '').trim()
}

function pickDirection(log: GhlCallLog): 'inbound' | 'outbound' {
  const raw = String(log.direction ?? log.callDirection ?? '').toLowerCase()
  return raw === 'outbound' || raw === 'outgoing' ? 'outbound' : 'inbound'
}

function pickDuration(log: GhlCallLog): number {
  const raw = log.durationSec ?? log.duration ?? log.callDuration ?? 0
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function pickContactName(log: GhlCallLog): string | undefined {
  if (log.contactName) return String(log.contactName)
  const c = log.contact
  if (c) {
    if (c.fullName) return c.fullName
    if (c.name) return c.name
    const joined = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
    if (joined) return joined
  }
  return undefined
}

function pickStartedAt(log: GhlCallLog): string {
  const raw = log.startedAt ?? log.startTime ?? log.createdAt ?? log.dateAdded
  if (raw) {
    const d = new Date(String(raw))
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

/**
 * Map a GHL Voice AI call-log into our `Call`. `agentId` is required by the
 * schema; we fall back to a synthetic-but-stable id when GHL omits it so the
 * call still groups under one agent in the dashboard.
 */
export function mapCallLogToCall(log: GhlCallLog, source: 'webhook' | 'poll' = 'poll'): Call {
  const id = pickCallId(log) || `ghl-${pickStartedAt(log)}`
  const agentId = String(log.agentId ?? log.assistantId ?? log.aiAgentId ?? 'ghl-voice-ai').trim() || 'ghl-voice-ai'
  const outcome = log.outcome ?? log.disposition ?? log.status
  const recordingUrl = (log.recordingUrl ?? log.recording) as string | undefined

  return CallSchema.parse({
    id,
    agentId,
    direction: pickDirection(log),
    durationSec: pickDuration(log),
    outcome: outcome ? String(outcome) : undefined,
    recordingUrl: recordingUrl ? String(recordingUrl) : undefined,
    contactName: pickContactName(log),
    startedAt: pickStartedAt(log),
    source
  })
}

/** Normalize the raw transcript field into a typed list of `Turn`s. */
function normalizeTurns(raw: unknown): Turn[] {
  if (raw == null) return []

  // Case 1: a single string transcript ("Agent: hi\nCustomer: hello").
  if (typeof raw === 'string') {
    return parseStringTranscript(raw)
  }

  // Case 2: an array of turn-like objects.
  if (Array.isArray(raw)) {
    const turns: Turn[] = []
    raw.forEach((entry, i) => {
      const t = coerceTurn(entry, turns.length)
      if (t) turns.push(t)
      else if (typeof entry === 'string') {
        const text = entry.trim()
        if (text) turns.push({ idx: turns.length, speaker: i % 2 === 0 ? 'agent' : 'customer', text })
      }
    })
    return turns
  }

  // Case 3: wrapped object, e.g. { messages: [...] } or { text: "..." }.
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const key of ['turns', 'messages', 'transcript', 'segments', 'utterances']) {
      if (Array.isArray(obj[key])) return normalizeTurns(obj[key])
    }
    if (typeof obj.text === 'string') return parseStringTranscript(obj.text)
  }
  return []
}

function mapSpeaker(rawSpeaker: unknown): Speaker {
  const s = String(rawSpeaker ?? '').toLowerCase()
  if (['agent', 'assistant', 'ai', 'bot', 'system', 'voice_ai', 'voiceai'].includes(s)) return 'agent'
  if (['customer', 'user', 'human', 'caller', 'contact', 'lead', 'prospect'].includes(s)) return 'customer'
  // Unknown -> default to customer so the agent's own lines aren't over-counted.
  return 'customer'
}

function coerceTurn(entry: unknown, idx: number): Turn | null {
  if (!entry || typeof entry !== 'object') return null
  const o = entry as Record<string, unknown>
  const text = String(o.text ?? o.message ?? o.content ?? o.transcript ?? o.utterance ?? '').trim()
  if (!text) return null
  const speaker = mapSpeaker(o.role ?? o.speaker ?? o.source ?? o.from ?? o.party)
  const tsRaw = o.tsSec ?? o.ts ?? o.start ?? o.startTime ?? o.timestamp
  const tsNum = Number(tsRaw)
  const tsSec = Number.isFinite(tsNum) && tsNum >= 0 ? tsNum : undefined
  return { idx, speaker, text, ...(tsSec !== undefined ? { tsSec } : {}) }
}

/** Parse a flat string transcript into turns using "Speaker: text" line cues. */
function parseStringTranscript(raw: string): Turn[] {
  const lines = raw.split(/\r?\n+/).map(l => l.trim()).filter(Boolean)
  const turns: Turn[] = []
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z _-]{2,20})\s*:\s*(.+)$/)
    if (m) {
      turns.push({ idx: turns.length, speaker: mapSpeaker(m[1]), text: m[2]!.trim() })
    } else {
      // No speaker prefix — alternate, starting with the agent.
      turns.push({ idx: turns.length, speaker: turns.length % 2 === 0 ? 'agent' : 'customer', text: line })
    }
  }
  return turns
}

/** Map a GHL call-log's transcript payload into our `Transcript`. */
export function mapCallLogToTranscript(log: GhlCallLog): Transcript {
  const id = pickCallId(log) || `ghl-${pickStartedAt(log)}`
  const rawTranscript = log.transcript ?? log.messages ?? log.transcription
  const turns = normalizeTurns(rawTranscript)
  return TranscriptSchema.parse({ callId: id, turns })
}
