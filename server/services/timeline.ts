/**
 * Call event timeline — models the realtime voice pipeline as a sequence of
 * stage events (VAD -> STT -> EOU -> LLM -> TTS -> agent audio).
 *
 * HONESTY: HighLevel's Voice AI call-log exposes NO per-stage latency, so the
 * decomposition here is MODELED, anchored on LiveKit's published budgets:
 *   e2e_latency ~= end_of_utterance_delay + llm.ttft + tts.ttfb   (target < 1s)
 * Turn boundaries come from the transcript; only the sub-stage timing is invented.
 * The model is deterministic (PRNG seeded by callId) so it never flickers, and a
 * real-data path (`buildTimelineFromSentences`) consumes per-sentence start/end
 * timestamps from HighLevel's transcription endpoint when available.
 */
import { randomUUID } from 'node:crypto'
import type { Call, CallEvent, CallTimeline, Stage, StageLatency, Transcript, Turn } from '#shared/types'

/** All modeled constants in one place — cited in the UI tooltip and README. */
export const LATENCY_MODEL = {
  version: 'latency-model-v1',
  charsPerSec: 15, // ~150 wpm speech rate
  minSpeechMs: 700,
  sttFirstPartialMs: 140, // STT first interim transcript
  sttMsPerChar: 4,
  sttFinalizeMaxMs: 400,
  vadTrailingMs: 200, // trailing-silence window before endpointing
  eou: { meanMs: 550, sdMs: 80 }, // LiveKit turn-detector min_delay ~0.5s
  llmTtft: { meanMs: 420, sdMs: 120 }, // LLMMetrics.ttft
  ttsTtfb: { meanMs: 180, sdMs: 40 }, // TTSMetrics.ttfb
  interruptionOverlapMs: 350
} as const

/** Synthesize a fully-modeled timeline from a transcript (the demo path). */
export function synthesizeTimeline(call: Call, transcript: Transcript): CallTimeline {
  const rng = mulberry32(hashSeed(call.id))
  const norm = (mean: number, sd: number) => Math.max(40, Math.round(mean + gaussian(rng) * sd))

  const turns = [...transcript.turns].sort((a, b) => a.idx - b.idx)
  const events: CallEvent[] = []
  const responseLatencies: number[] = []
  let interruptionCount = 0
  let clock = 0
  let lastUserSpeechEnd = 0

  const push = (e: Omit<CallEvent, 'id' | 'callId' | 'meta'> & { meta?: CallEvent['meta'] }) =>
    events.push({ id: randomUUID(), callId: call.id, meta: {}, ...e })

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!
    const interrupted = isUtteranceFinalCut(turn) && i + 1 < turns.length
    const speechMs = speechDuration(turn.text)

    if (turn.speaker === 'customer') {
      const start = clock
      const end = start + (interrupted ? Math.round(speechMs * 0.55) : speechMs)
      push({ stage: 'user_speech', type: 'speech', turnIdx: turn.idx, tStartMs: start, tEndMs: end })
      push({
        stage: 'stt',
        type: 'final',
        turnIdx: turn.idx,
        tStartMs: start + LATENCY_MODEL.sttFirstPartialMs,
        tEndMs: end + sttFinalizeMs(turn.text),
        latencyMs: sttFinalizeMs(turn.text)
      })
      const vadStart = end
      const vadEnd = vadStart + LATENCY_MODEL.vadTrailingMs
      push({ stage: 'vad', type: 'speech_end', turnIdx: turn.idx, tStartMs: vadStart, tEndMs: vadEnd })
      const eouDelay = norm(LATENCY_MODEL.eou.meanMs, LATENCY_MODEL.eou.sdMs)
      push({ stage: 'eou', type: 'end_of_utterance', turnIdx: turn.idx, tStartMs: vadEnd, tEndMs: vadEnd + eouDelay, latencyMs: eouDelay })
      lastUserSpeechEnd = end
      clock = vadEnd + eouDelay

      if (interrupted) {
        // The customer barged in: the next (agent) turn starts before this ends.
        interruptionCount++
        push({ stage: 'interruption', type: 'barge_in', turnIdx: turn.idx, tStartMs: end, tEndMs: end, meta: { by: 'customer' } })
      }
    } else {
      // Agent response: the pipeline (LLM, TTS) runs, then the agent speaks.
      const llmStart = clock
      const ttft = norm(LATENCY_MODEL.llmTtft.meanMs, LATENCY_MODEL.llmTtft.sdMs)
      push({ stage: 'llm', type: 'ttft', turnIdx: turn.idx, tStartMs: llmStart, tEndMs: llmStart + ttft, latencyMs: ttft })
      const ttsStart = llmStart + ttft
      const ttfb = norm(LATENCY_MODEL.ttsTtfb.meanMs, LATENCY_MODEL.ttsTtfb.sdMs)
      push({ stage: 'tts', type: 'ttfb', turnIdx: turn.idx, tStartMs: ttsStart, tEndMs: ttsStart + ttfb, latencyMs: ttfb })

      const speakStart = ttsStart + ttfb
      const speakEnd = speakStart + (interrupted ? Math.round(speechMs * 0.55) : speechMs)
      push({ stage: 'agent_speech', type: 'speech', turnIdx: turn.idx, tStartMs: speakStart, tEndMs: speakEnd })

      // Response latency = user speech end -> agent audio start (the headline metric).
      if (lastUserSpeechEnd > 0) responseLatencies.push(speakStart - lastUserSpeechEnd)
      clock = interrupted ? speakEnd - LATENCY_MODEL.interruptionOverlapMs : speakEnd

      if (interrupted) {
        interruptionCount++
        push({ stage: 'interruption', type: 'barge_in', turnIdx: turn.idx, tStartMs: speakEnd, tEndMs: speakEnd, meta: { by: 'agent_cut' } })
      }
    }
  }

  return finalizeTimeline(call.id, 'modeled', events, responseLatencies, interruptionCount)
}

/** Per-sentence transcription record from HighLevel's transcription endpoint. */
export interface TranscriptionSentence {
  startTimeMs: number
  endTimeMs: number
  channel: number // 0/1 leg; even = agent by convention here
  text: string
  confidence?: number
}

/**
 * Real-data path: build a timeline from HighLevel per-sentence transcription
 * (startTime/endTime in ms are REAL). The inter-turn gap is real; we still MODEL
 * the EOU/LLM/TTS split within that real gap, anchored on the same budgets.
 */
export function buildTimelineFromSentences(callId: string, sentences: TranscriptionSentence[]): CallTimeline {
  const rng = mulberry32(hashSeed(callId))
  const sorted = [...sentences].sort((a, b) => a.startTimeMs - b.startTimeMs)
  const events: CallEvent[] = []
  const responseLatencies: number[] = []
  let lastUserEnd = 0
  const push = (e: Omit<CallEvent, 'id' | 'callId' | 'meta'> & { meta?: CallEvent['meta'] }) =>
    events.push({ id: randomUUID(), callId, meta: {}, ...e })

  sorted.forEach((s, idx) => {
    const isAgent = s.channel % 2 === 0
    const stage: Stage = isAgent ? 'agent_speech' : 'user_speech'
    push({ stage, type: 'speech', turnIdx: idx, tStartMs: s.startTimeMs, tEndMs: s.endTimeMs, meta: s.confidence != null ? { confidence: s.confidence } : {} })

    if (isAgent && lastUserEnd > 0) {
      // Decompose the REAL gap (lastUserEnd -> agent start) into modeled sub-stages.
      const gap = Math.max(0, s.startTimeMs - lastUserEnd)
      const eou = Math.round(gap * 0.45)
      const ttft = Math.round(gap * 0.35)
      const ttfb = gap - eou - ttft
      push({ stage: 'eou', type: 'end_of_utterance', turnIdx: idx, tStartMs: lastUserEnd, tEndMs: lastUserEnd + eou, latencyMs: eou })
      push({ stage: 'llm', type: 'ttft', turnIdx: idx, tStartMs: lastUserEnd + eou, tEndMs: lastUserEnd + eou + ttft, latencyMs: ttft })
      push({ stage: 'tts', type: 'ttfb', turnIdx: idx, tStartMs: lastUserEnd + eou + ttft, tEndMs: s.startTimeMs, latencyMs: Math.max(0, ttfb) })
      responseLatencies.push(gap)
    }
    if (!isAgent) lastUserEnd = s.endTimeMs
    void rng
  })

  return finalizeTimeline(callId, 'ingested', events, responseLatencies, 0)
}

/* -------------------------------------------------------------------------- */

function finalizeTimeline(
  callId: string,
  source: 'modeled' | 'ingested',
  events: CallEvent[],
  responseLatencies: number[],
  interruptionCount: number
): CallTimeline {
  const totalMs = events.reduce((max, e) => Math.max(max, e.tEndMs), 0)
  const avgResponseLatencyMs = responseLatencies.length
    ? Math.round(responseLatencies.reduce((a, b) => a + b, 0) / responseLatencies.length)
    : 0
  return {
    callId,
    source,
    modelVersion: LATENCY_MODEL.version,
    events: events.sort((a, b) => a.tStartMs - b.tStartMs),
    perStageLatency: rollupStageLatency(events),
    interruptionCount,
    avgResponseLatencyMs,
    totalMs
  }
}

/** p50/p95/max per stage over each event's latencyMs (or its duration). */
function rollupStageLatency(events: CallEvent[]): StageLatency[] {
  const byStage = new Map<Stage, number[]>()
  for (const e of events) {
    if (e.stage === 'interruption') continue
    const v = e.latencyMs ?? e.tEndMs - e.tStartMs
    const arr = byStage.get(e.stage) ?? []
    arr.push(v)
    byStage.set(e.stage, arr)
  }
  const out: StageLatency[] = []
  for (const [stage, values] of byStage) {
    const sorted = values.sort((a, b) => a - b)
    out.push({
      stage,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1] ?? 0,
      count: sorted.length
    })
  }
  return out
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return Math.round(sorted[idx]!)
}

function speechDuration(text: string): number {
  return Math.max(LATENCY_MODEL.minSpeechMs, Math.round((text.length / LATENCY_MODEL.charsPerSec) * 1000))
}

function sttFinalizeMs(text: string): number {
  return Math.min(LATENCY_MODEL.sttFinalizeMaxMs, Math.round(text.length * LATENCY_MODEL.sttMsPerChar))
}

/** Trailing dash that is utterance-final = a real barge-in marker in the seed data. */
function isUtteranceFinalCut(turn: Turn): boolean {
  return /[—-]\s*$/.test(turn.text.trim())
}

/* deterministic PRNG + gaussian so the modeled timeline is stable per call */
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng: () => number): number {
  // Box-Muller
  const u = 1 - rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
