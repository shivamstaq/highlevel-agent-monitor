/**
 * Seeds storage with a rich, deliberately-flawed dataset so the whole demo has
 * signal: 3 distinct Voice AI agents + 8 calls/transcripts spanning clean calls
 * and baked-in deviations, failures, and missed opportunities.
 *
 * Idempotent: re-running upserts the same ids, so calling /api/seed repeatedly
 * is safe and never duplicates data.
 */
import { randomUUID } from 'node:crypto'
import seedData from '../../data/seed/transcripts.json'
import type { Agent, Call, Transcript, SuccessCriterion, Turn, Speaker } from '#shared/types'
import { upsertAgent, upsertCall, upsertTranscript } from '../services/db'

interface SeedAgent {
  id: string
  name: string
  goal: string
  script: string
  successCriteria: SuccessCriterion[]
}

interface SeedTurn {
  speaker: Speaker
  text: string
}

interface SeedCall {
  id: string
  agentId: string
  direction: 'inbound' | 'outbound'
  durationSec: number
  outcome: string
  contactName: string
  startedAt: string
  transcript: SeedTurn[]
}

interface SeedFile {
  agents: SeedAgent[]
  calls: SeedCall[]
}

export interface SeedResult {
  agents: number
  calls: number
}

/**
 * P02: the seed JSON hard-codes absolute 2026-06 startedAt dates, so as wall-clock
 * time moves on the demo's relative times ("4d ago") and the Fleet-health trend
 * delta drift away from "today" and start asserting stale, untruthful numbers.
 *
 * Instead of trusting those frozen dates we re-anchor the whole spread onto NOW
 * at seed time: the single most-recent call lands ~1h ago and every older call
 * keeps its ORIGINAL relative spacing, compressed so the run fits in a ~6-day
 * window. The result is a dataset whose newest day is genuinely today, making the
 * relative-time labels and any day-over-day trend honest by construction.
 *
 * Date.now()/new Date() are intentionally used here (runtime seed), per the brief.
 */
const MOST_RECENT_OFFSET_MS = 60 * 60 * 1000 // newest call sits ~1h before now
const SPREAD_WINDOW_MS = 6 * 24 * 60 * 60 * 1000 // older calls fan back ~6 days

/**
 * Map the seed calls' frozen startedAt onto a window ending ~1h ago, preserving
 * their relative ordering/spacing. Returns a callId -> ISO timestamp map.
 */
function deriveStartedAt(calls: SeedCall[], nowMs: number): Map<string, string> {
  const times = calls.map(c => new Date(c.startedAt).getTime())
  const oldest = Math.min(...times)
  const newest = Math.max(...times)
  const rawSpan = newest - oldest
  const anchor = nowMs - MOST_RECENT_OFFSET_MS // where the newest call lands

  const out = new Map<string, string>()
  for (const c of calls) {
    const raw = new Date(c.startedAt).getTime()
    // 0 at the newest call, 1 at the oldest; scale into the spread window.
    const ageFraction = rawSpan > 0 ? (newest - raw) / rawSpan : 0
    const shifted = anchor - ageFraction * SPREAD_WINDOW_MS
    out.set(c.id, new Date(shifted).toISOString())
  }
  return out
}

/**
 * Approximate per-turn timestamps by spreading them evenly across the call
 * duration. Gives the transcript viewer something believable without inventing
 * data the dataset doesn't carry.
 */
function withTimestamps(turns: SeedTurn[], durationSec: number): Turn[] {
  const n = turns.length
  return turns.map((t, idx) => ({
    idx,
    speaker: t.speaker,
    text: t.text,
    tsSec: n > 1 ? Math.round((durationSec * idx) / (n - 1)) : 0
  }))
}

export async function seed(): Promise<SeedResult> {
  const data = seedData as SeedFile
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  // Re-anchor the frozen seed dates onto a window ending ~now (P02).
  const startedAtById = deriveStartedAt(data.calls, nowMs)

  for (const a of data.agents) {
    const agent: Agent = {
      id: a.id,
      name: a.name,
      goal: a.goal,
      script: a.script,
      successCriteria: a.successCriteria,
      createdAt: now,
      updatedAt: now
    }
    await upsertAgent(agent)
  }

  for (const c of data.calls) {
    const call: Call = {
      id: c.id,
      agentId: c.agentId,
      direction: c.direction,
      durationSec: c.durationSec,
      outcome: c.outcome,
      contactName: c.contactName,
      startedAt: startedAtById.get(c.id) ?? c.startedAt,
      source: 'seed'
    }
    await upsertCall(call)

    const transcript: Transcript = {
      callId: c.id,
      turns: withTimestamps(c.transcript, c.durationSec)
    }
    await upsertTranscript(transcript)
  }

  return { agents: data.agents.length, calls: data.calls.length }
}

/**
 * Exposed so other tooling can mint ids consistently with the rest of the data
 * layer (seed ids are stable strings; runtime-ingested entities use UUIDs).
 */
export function newId(): string {
  return randomUUID()
}
