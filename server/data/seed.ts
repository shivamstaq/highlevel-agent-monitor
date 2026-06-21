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
  const now = new Date().toISOString()

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
      startedAt: c.startedAt,
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
