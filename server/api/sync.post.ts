// BORROWED (mirrors GHL)
/**
 * POST /api/sync — poll GHL Voice AI call-logs and ingest calls + transcripts.
 *
 * Pulls from the LIST endpoint (it carries the full `transcriptWithToolCalls` —
 * the detail endpoint drops it), paginating pageSize=50 and INCLUDING trial
 * calls (a sandbox is trial-only). Each log maps to a `Call` + normalized
 * `Transcript` (turns + inline actions); REAL per-turn latency is computed from
 * the structured turn times and persisted as a `partial-real` CallTimeline (the
 * sub-stage breakdown is the eval layer's modeled concern). Dedupe is by call id.
 *
 * Analysis is triggered best-effort per ingested call (M3 eval layer); a missing
 * provider / module never fails ingestion.
 *
 * Body: { locationId?: string, agentId?: string }. Falls back to runtimeConfig.
 */
import type { Call, Transcript, PerTurnLatency, CallType, GhlCallLog } from '#shared/types'
import type { GhlClient } from '../services/ghl'
import { createGhlClient, mapCallLog, computePerTurnLatency, buildAgentFromGhl } from '../services/ghl'
import { upsertCall, upsertTranscript, getCall, getTranscript, getAgent, upsertAgent, upsertTimeline } from '../services/db'
import { analyzeCall } from '../services/eval/analysis'

interface Body {
  locationId?: string
  agentId?: string
  /** Raise the per-sync page ceiling for a manual backfill (default bounded). */
  maxPages?: number
  /** Which call class to ingest (default TRIAL — the sandbox is trial-only). */
  callType?: CallType
  /** Run the heavy LLM analysis pass inline (default false → deferred). */
  analyze?: boolean
  /** How many ingested calls to auto-analyze inline when analysis runs. */
  analyzeLimit?: number
}

/**
 * Default cap on how many freshly-ingested calls auto-analyze inline. Each
 * analysis can fan out to several Claude calls; on Cloudflare (≈30s CPU,
 * 1000-subrequest budget) an unbounded inline pass blows the limit. Anything
 * beyond this is returned in `pendingAnalysis` for the on-demand
 * /api/analyze/[callId] path (which the UI already calls) — never silently
 * dropped.
 */
const DEFAULT_INLINE_ANALYZE_LIMIT = 5

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const body = await readBody<Body>(event).catch(() => ({} as Body))
  const locationId = body?.locationId || (config as Record<string, string>).ghlLocationId || ''

  if (!config.ghlPitToken) {
    return { ingested: 0, skipped: 0, errors: ['GHL_PIT_TOKEN not set'] }
  }
  if (!locationId) {
    return { ingested: 0, skipped: 0, errors: ['locationId required (body.locationId or GHL_LOCATION_ID)'] }
  }

  const client = createGhlClient({ apiBase: config.ghlApiBase, pitToken: config.ghlPitToken, locationId })
  const errors: string[] = []
  const ingestedIds: string[] = []
  let ingested = 0
  let skipped = 0

  // Ingest each fetched log inline (per-page callback) so a fully-already-seen
  // page can stop pagination early — incremental sync that doesn't re-walk all
  // of history every time. The callback returns `false` to stop.
  const ingestLog = async (log: GhlCallLog): Promise<'ingested' | 'skipped'> => {
    const { call, transcript } = mapCallLog(log, 'poll')
    if (!call.id) return 'skipped'

    // Dedupe by id: skip if already stored AND unchanged in turn count.
    const existing = await getCall(call.id)
    if (existing) {
      const prior = await getTranscript(call.id)
      if (prior && prior.entries.length === transcript.entries.length) {
        return 'skipped'
      }
    }

    await persist(call, transcript, errors)
    ingestedIds.push(call.id)
    return 'ingested'
  }

  try {
    await client.listCallLogs(locationId, {
      pageSize: 50,
      // Bounded by default (Cloudflare subrequest/CPU budget); body.maxPages
      // opts into a larger manual backfill.
      ...(typeof body?.maxPages === 'number' ? { maxPages: body.maxPages } : {}),
      ...(body?.agentId ? { agentId: body.agentId } : {}),
      ...(body?.callType ? { callType: body.callType } : {}),
      // Ingest each page as it arrives; if the ENTIRE page was already
      // ingested-and-unchanged, stop early (return false) so we don't keep
      // walking deep history on every routine sync.
      onPage: async (pageLogs) => {
        let pageIngested = 0
        for (const log of pageLogs) {
          try {
            const outcome = await ingestLog(log)
            if (outcome === 'skipped') skipped++
            else {
              ingested++
              pageIngested++
            }
          } catch (err) {
            errors.push(`map/store failed for ${log.id ?? 'unknown'}: ${(err as Error).message}`)
          }
        }
        // Whole page produced no new ingestion → assume we've reached already-seen
        // history (GHL returns newest-first); stop paginating.
        if (pageLogs.length > 0 && pageIngested === 0) return false
        return undefined
      }
    })
  } catch (err) {
    errors.push((err as Error).message)
  }

  // ── Analysis: DECOUPLED from ingest. Heavy (≈4 Claude calls/call). Run inline
  // only when opted in (body.analyze) and only up to a bounded count; the rest
  // are returned as `pendingAnalysis` for the on-demand /api/analyze/[callId]
  // path. Nothing is silently dropped. ────────────────────────────────────────
  const wantAnalyze = body?.analyze === true
  const inlineLimit = Math.max(0, body?.analyzeLimit ?? DEFAULT_INLINE_ANALYZE_LIMIT)
  let analyzed = 0
  const pendingAnalysis: string[] = []

  if (wantAnalyze) {
    for (const id of ingestedIds) {
      if (analyzed >= inlineLimit) {
        pendingAnalysis.push(id)
        continue
      }
      try {
        const ran = await triggerAnalysis(id, client, errors)
        if (ran) analyzed++
        else pendingAnalysis.push(id) // skipped (e.g. auto-sync failed) — surfaced
      } catch (err) {
        errors.push(`analysis failed for ${id}: ${(err as Error).message}`)
        pendingAnalysis.push(id)
      }
    }
  } else {
    // Deferred by default — surface the ids so the UI/operator can analyze
    // on demand rather than blowing the request CPU budget here.
    pendingAnalysis.push(...ingestedIds)
  }

  const result: {
    ingested: number
    skipped: number
    analyzed: number
    pendingAnalysis: string[]
    errors?: string[]
  } = { ingested, skipped, analyzed, pendingAnalysis }
  if (errors.length > 0) result.errors = errors
  return result
})

/**
 * Persist a call + transcript, and the REAL latency headline as a timeline.
 * The timeline is non-critical to call ingestion, so its failure is COLLECTED
 * into `errors` (surfaced in the response) rather than swallowed or fatal.
 */
async function persist(call: Call, transcript: Transcript, errors: string[]): Promise<void> {
  await upsertCall(call)
  await upsertTranscript(transcript)

  const perTurn = computePerTurnLatency(transcript.entries)
  try {
    await persistRealTimeline(call.id, perTurn, transcript)
  } catch (err) {
    errors.push(`timeline persist failed for ${call.id}: ${(err as Error).message}`)
  }
}

/**
 * Persist the REAL per-turn-latency headline as a `partial-real` CallTimeline.
 * The MODELED sub-stage events (VAD/STT/EOU/LLM/TTS) are the eval layer's
 * concern (M3 timeline.ts) — here we only record what GHL actually gave us, so
 * the honesty flag holds. Throws on failure; the caller (`persist`) collects the
 * error into the response so a timeline hiccup is surfaced, not swallowed.
 */
async function persistRealTimeline(
  callId: string,
  perTurn: PerTurnLatency[],
  transcript: Transcript
): Promise<void> {
  {
    const avgResponseLatencyMs
      = perTurn.length > 0
        ? Math.round(perTurn.reduce((s, p) => s + p.latencyMs, 0) / perTurn.length)
        : 0

    // REAL barge-in proxy: a customer turn that starts before the prior agent
    // turn ended (overlap). totalMs = last observed boundary.
    let interruptionCount = 0
    let lastAgentEnd = -1
    let totalSec = 0
    for (const e of transcript.entries) {
      if (e.role === 'agent') {
        lastAgentEnd = e.endSec
        totalSec = Math.max(totalSec, e.endSec)
      } else if (e.role === 'customer') {
        if (lastAgentEnd >= 0 && e.startSec < lastAgentEnd) interruptionCount++
        totalSec = Math.max(totalSec, e.endSec)
      } else {
        totalSec = Math.max(totalSec, e.atSec)
      }
    }

    await upsertTimeline({
      callId,
      source: 'partial-real',
      avgResponseLatencyMs,
      perTurnLatency: perTurn,
      events: [], // MODELED sub-stages are synthesized by the eval layer on demand
      interruptionCount,
      totalMs: Math.round(totalSec * 1000)
    })
  }
}

/**
 * Analysis trigger (M3 eval layer). Loads the call's enriched agent + normalized
 * transcript and drives the eval pipeline.
 *
 * ORDERING SAFETY: if the agent was never synced (agents/sync not run first),
 * the analysis used to SILENTLY no-op. Now it AUTO-SYNCS the agent on demand —
 * fetch its config + flow graph from GHL and persist it — before analyzing, so
 * a call can never be silently left unanalyzed because of sync order. If the
 * auto-sync itself fails (e.g. agent deleted upstream / provider down), a clear
 * error is pushed to `errors[]` and analysis is skipped for this call.
 */
async function triggerAnalysis(callId: string, client: GhlClient, errors: string[]): Promise<boolean> {
  const call = await getCall(callId)
  if (!call) {
    errors.push(`analysis skipped for ${callId}: call not found after ingest`)
    return false
  }

  let [agent, transcript] = await Promise.all([
    getAgent(call.agentId),
    getTranscript(callId)
  ])

  if (!agent) {
    // Auto-sync the missing agent rather than silently skipping.
    try {
      const ghl = await client.getAgent(call.agentId)
      agent = await buildAgentFromGhl(client, ghl, new Date().toISOString())
      agent = await upsertAgent(agent)
    } catch (err) {
      errors.push(
        `analysis skipped for ${callId}: agent ${call.agentId} not synced and auto-sync failed — ${(err as Error).message}`
      )
      return false
    }
  }

  if (!transcript) {
    errors.push(`analysis skipped for ${callId}: transcript missing`)
    return false
  }

  await analyzeCall(agent, transcript)
  return true
}
