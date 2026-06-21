/**
 * Typed storage layer over Nitro's `useStorage('data')` (fs driver, mounted in
 * server/plugins/storage.ts). Every other slice imports these helpers instead of
 * touching storage directly.
 *
 * Keyspace (SPEC.json contract.storageKeyspace):
 *   agents:<agentId>        -> Agent
 *   calls:<callId>          -> Call
 *   transcripts:<callId>    -> Transcript
 *   analyses:<callId>       -> Analysis
 */
import type { Agent, Call, Transcript, Analysis, ExpectedFlow, CallTimeline } from '#shared/types'
import { AgentSchema, CallSchema, TranscriptSchema, AnalysisSchema, ExpectedFlowSchema, CallTimelineSchema } from '#shared/types'

type Storage = ReturnType<typeof useStorage>

const NS = 'data'

function store(): Storage {
  return useStorage(NS)
}

/**
 * The fs driver represents `:` separated keys as nested paths and reports keys
 * back joined with `:`. `getKeys(prefix)` returns fully-qualified keys; we strip
 * the prefix to recover the raw id for the caller.
 */
async function readAll<T>(prefix: string, schema: { parse: (v: unknown) => T }): Promise<T[]> {
  const s = store()
  const keys = await s.getKeys(prefix)
  const out: T[] = []
  for (const key of keys) {
    const raw = await s.getItem(key)
    if (raw != null) out.push(schema.parse(raw))
  }
  return out
}

/* ----------------------------------------------------------------------------
 * Agents
 * ------------------------------------------------------------------------- */
export async function listAgents(): Promise<Agent[]> {
  const agents = await readAll('agents:', AgentSchema)
  return agents.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getAgent(id: string): Promise<Agent | null> {
  const raw = await store().getItem(`agents:${id}`)
  return raw == null ? null : AgentSchema.parse(raw)
}

export async function upsertAgent(a: Agent): Promise<Agent> {
  const agent = AgentSchema.parse(a)
  await store().setItem(`agents:${agent.id}`, agent)
  return agent
}

/* ----------------------------------------------------------------------------
 * Calls
 * ------------------------------------------------------------------------- */
export async function listCalls(filter?: { agentId?: string }): Promise<Call[]> {
  let calls = await readAll('calls:', CallSchema)
  if (filter?.agentId) {
    calls = calls.filter(c => c.agentId === filter.agentId)
  }
  // Most recent first — the dashboard wants newest calls at the top.
  return calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function getCall(id: string): Promise<Call | null> {
  const raw = await store().getItem(`calls:${id}`)
  return raw == null ? null : CallSchema.parse(raw)
}

export async function upsertCall(c: Call): Promise<Call> {
  const call = CallSchema.parse(c)
  await store().setItem(`calls:${call.id}`, call)
  return call
}

/* ----------------------------------------------------------------------------
 * Transcripts (keyed by callId)
 * ------------------------------------------------------------------------- */
export async function getTranscript(callId: string): Promise<Transcript | null> {
  const raw = await store().getItem(`transcripts:${callId}`)
  return raw == null ? null : TranscriptSchema.parse(raw)
}

export async function upsertTranscript(t: Transcript): Promise<Transcript> {
  const transcript = TranscriptSchema.parse(t)
  await store().setItem(`transcripts:${transcript.callId}`, transcript)
  return transcript
}

/* ----------------------------------------------------------------------------
 * Analyses (keyed by callId)
 * ------------------------------------------------------------------------- */
export async function getAnalysis(callId: string): Promise<Analysis | null> {
  const raw = await store().getItem(`analyses:${callId}`)
  return raw == null ? null : AnalysisSchema.parse(raw)
}

export async function upsertAnalysis(a: Analysis): Promise<Analysis> {
  const analysis = AnalysisSchema.parse(a)
  await store().setItem(`analyses:${analysis.callId}`, analysis)
  return analysis
}

export async function listAnalyses(): Promise<Analysis[]> {
  return readAll('analyses:', AnalysisSchema)
}

/* ----------------------------------------------------------------------------
 * Expected call flows (keyed by agentId)
 * ------------------------------------------------------------------------- */
export async function getExpectedFlow(agentId: string): Promise<ExpectedFlow | null> {
  const raw = await store().getItem(`flows:${agentId}`)
  return raw == null ? null : ExpectedFlowSchema.parse(raw)
}

export async function upsertExpectedFlow(f: ExpectedFlow): Promise<ExpectedFlow> {
  const flow = ExpectedFlowSchema.parse(f)
  await store().setItem(`flows:${flow.agentId}`, flow)
  return flow
}

/* ----------------------------------------------------------------------------
 * Ingested timelines (keyed by callId) — only present when real per-event
 * timing was pulled from HighLevel; otherwise the call route models one on read.
 * ------------------------------------------------------------------------- */
export async function getTimeline(callId: string): Promise<CallTimeline | null> {
  const raw = await store().getItem(`timelines:${callId}`)
  return raw == null ? null : CallTimelineSchema.parse(raw)
}

export async function upsertTimeline(t: CallTimeline): Promise<CallTimeline> {
  const timeline = CallTimelineSchema.parse(t)
  await store().setItem(`timelines:${timeline.callId}`, timeline)
  return timeline
}
