// CREATED (our eval layer)
/**
 * Call Timeline — REAL per-turn latency + MODELED voice-pipeline sub-stages
 * (redesign §4; honesty flag `source: 'partial-real'`).
 *
 * REAL (computed straight from `transcriptWithToolCalls` start/end seconds, which
 * the phase-1 capture confirmed are present even for trial web calls):
 *   - perTurnLatency: gap from a customer turn's end → the next agent turn's start.
 *   - avgResponseLatencyMs: mean of those gaps (the headline number).
 *   - interruptionCount: overlapping-turn (barge-in) proxy.
 *   - totalMs: last entry end − first entry start.
 *   - one `agent_speech` / `user_speech` event per turn (provenance: 'real').
 *
 * MODELED (NOT exposed by GHL — phase-1 notes §"Telemetry"): the per-turn
 * VAD → STT → EOU → LLM → TTS sub-stage breakdown. We synthesize these inside each
 * agent response gap with a plausible, deterministic split and flag every one
 * `provenance: 'modeled'`. They never inflate the REAL headline metric.
 */
import type {
  Transcript,
  TranscriptEntry,
  TurnEntry,
  CallEvent,
  PerTurnLatency,
  CallTimeline
} from '#shared/types'
import { CallTimelineSchema } from '#shared/types'

const SEC = 1000

/** Deterministic split of an agent response gap into modeled sub-stages (sums to 1). */
const STAGE_SPLIT: { stage: CallEvent['stage'], frac: number }[] = [
  { stage: 'vad', frac: 0.08 }, // end-of-user-speech detection
  { stage: 'stt', frac: 0.22 }, // transcription
  { stage: 'eou', frac: 0.06 }, // end-of-utterance confirmation
  { stage: 'llm', frac: 0.5 }, // model inference (dominant)
  { stage: 'tts', frac: 0.14 } // speech synthesis to first audio
]

export function buildTimeline(transcript: Transcript): CallTimeline {
  const entries = transcript.entries
  const turns = entries.filter(isTurn)

  const events: CallEvent[] = []
  const perTurnLatency: PerTurnLatency[] = []

  // 1. REAL speech events — one per spoken turn.
  for (const t of turns) {
    events.push({
      id: `ev:${transcript.callId}:${t.idx}:speech`,
      callId: transcript.callId,
      entryIdx: t.idx,
      stage: t.role === 'agent' ? 'agent_speech' : 'user_speech',
      provenance: 'real',
      tStartMs: t.startSec * SEC,
      tEndMs: t.endSec * SEC,
      latencyMs: Math.max(0, (t.endSec - t.startSec) * SEC)
    })
  }

  // 2. REAL response latency — for each agent turn, the preceding customer turn's
  //    end → this agent turn's start. Also seeds the MODELED sub-stage breakdown.
  let interruptionCount = 0
  for (let i = 0; i < turns.length; i++) {
    const cur = turns[i]!
    const prev = turns[i - 1]
    if (!prev) continue

    // Barge-in proxy: this turn starts before the previous turn finished.
    if (cur.startSec < prev.endSec - 0.05) interruptionCount++

    if (cur.role === 'agent' && prev.role === 'customer') {
      const gapMs = Math.max(0, (cur.startSec - prev.endSec) * SEC)
      perTurnLatency.push({
        agentEntryIdx: cur.idx,
        customerEntryIdx: prev.idx,
        latencyMs: round(gapMs)
      })
      // MODELED sub-stages occupy the response gap [prev.end, cur.start).
      events.push(...modelStages(transcript.callId, cur.idx, prev.endSec * SEC, gapMs))
    }
  }

  const avgResponseLatencyMs
    = perTurnLatency.length === 0
      ? 0
      : round(perTurnLatency.reduce((s, p) => s + p.latencyMs, 0) / perTurnLatency.length)

  const totalMs = computeTotalMs(entries)

  events.sort((a, b) => a.tStartMs - b.tStartMs)

  return CallTimelineSchema.parse({
    callId: transcript.callId,
    source: 'partial-real',
    avgResponseLatencyMs,
    perTurnLatency,
    events,
    interruptionCount,
    totalMs: round(totalMs)
  })
}

/* -------------------------------------------------------------------------- */
/* Modeled sub-stage synthesis                                                */
/* -------------------------------------------------------------------------- */

function modelStages(
  callId: string,
  agentEntryIdx: number,
  gapStartMs: number,
  gapMs: number
): CallEvent[] {
  if (gapMs <= 0) return []
  const out: CallEvent[] = []
  let cursor = gapStartMs
  for (const { stage, frac } of STAGE_SPLIT) {
    const durMs = gapMs * frac
    out.push({
      id: `ev:${callId}:${agentEntryIdx}:${stage}`,
      callId,
      entryIdx: agentEntryIdx,
      stage,
      provenance: 'modeled',
      tStartMs: round(cursor),
      tEndMs: round(cursor + durMs),
      latencyMs: round(durMs)
    })
    cursor += durMs
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function computeTotalMs(entries: TranscriptEntry[]): number {
  if (entries.length === 0) return 0
  let min = Infinity
  let max = 0
  for (const e of entries) {
    const start = isTurn(e) ? e.startSec : e.atSec
    const end = isTurn(e) ? e.endSec : e.atSec
    if (start < min) min = start
    if (end > max) max = end
  }
  if (!Number.isFinite(min)) return 0
  return Math.max(0, (max - min) * SEC)
}

function isTurn(e: TranscriptEntry): e is TurnEntry {
  return e.role === 'agent' || e.role === 'customer'
}

function round(n: number): number {
  return Math.round(n)
}
