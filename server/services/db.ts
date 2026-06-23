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
import type { Agent, Call, Transcript, Analysis, ExpectedFlow, CallTimeline, AnalysisStatus } from '#shared/types'
import { AgentSchema, CallSchema, TranscriptSchema, AnalysisSchema, ExpectedFlowSchema, CallTimelineSchema, AnalysisStatusSchema } from '#shared/types'
import type { AnalysisSummary, FleetIndex, AgentsIndex, CallsIndex } from '../utils/rollup'
import {
  FLEET_INDEX_VERSION,
  AGENTS_INDEX_VERSION,
  CALLS_INDEX_VERSION,
  toAnalysisSummary
} from '../utils/rollup'

type Storage = ReturnType<typeof useStorage>

const NS = 'data'

function store(): Storage {
  return useStorage(NS)
}

/**
 * Cloudflare KV soft-caps a single value at 25 MB. We refuse to write past a
 * conservative ceiling rather than let the driver silently 413/truncate — a
 * truncated transcript would corrupt every downstream eval. The guard FAILS
 * LOUD so the ingestion path surfaces the offending key, never a silent partial.
 */
const KV_MAX_VALUE_BYTES = 24 * 1024 * 1024 // 24 MB headroom under KV's 25 MB cap

type StoredValue = Parameters<Storage['setItem']>[1]

function assertValueFits(key: string, value: StoredValue): void {
  // Cheap byte estimate via the JSON the driver will serialise. Only meaningful
  // for the large entities (transcripts/analyses); tiny records never approach it.
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
  if (bytes > KV_MAX_VALUE_BYTES) {
    throw new Error(
      `db: refusing to write "${key}" — value is ${(bytes / 1024 / 1024).toFixed(1)} MB, `
      + `over the ${(KV_MAX_VALUE_BYTES / 1024 / 1024).toFixed(0)} MB per-value limit. `
      + `Chunk or trim this record (no silent truncation).`
    )
  }
}

/** setItem with the value-size guard applied. All writes route through here. */
async function putItem(key: string, value: StoredValue): Promise<void> {
  assertValueFits(key, value)
  await store().setItem(key, value)
}

/**
 * The fs driver represents `:` separated keys as nested paths and reports keys
 * back joined with `:`. `getKeys(prefix)` returns fully-qualified keys; we strip
 * the prefix to recover the raw id for the caller.
 *
 * On Cloudflare KV the cloudflareKVBinding driver pages through KV's list cursor
 * internally, so `getKeys` already returns the FULL key set across cursor pages —
 * we never assume a single unbounded page here. We batch the value reads via
 * `getItems` (one transaction) instead of N sequential `getItem` round-trips,
 * cutting subrequest count on the scan path. Prefer the paginated/index reads
 * below for list/overview screens; this full scan is the parity/rebuild path.
 */
async function readAll<T>(prefix: string, schema: { parse: (v: unknown) => T }): Promise<T[]> {
  const s = store()
  const keys = await s.getKeys(prefix)
  return readKeys(keys, schema)
}

/** Batch-read a set of fully-qualified keys and parse the present values. */
async function readKeys<T>(keys: string[], schema: { parse: (v: unknown) => T }): Promise<T[]> {
  if (keys.length === 0) return []
  const s = store()
  const items = await s.getItems(keys)
  const out: T[] = []
  for (const { value } of items) {
    if (value != null) out.push(schema.parse(value))
  }
  return out
}

/**
 * A page of keys from a prefix scan. KV returns keys lexicographically; we sort
 * for a stable order and slice a window. `offset`/`limit` let the API/UI page
 * the table without materialising every value. `total` is the full key count so
 * the caller can render pagination controls.
 */
export interface Page<T> {
  items: T[]
  total: number
  offset: number
  limit: number
}

async function readPage<T>(
  prefix: string,
  schema: { parse: (v: unknown) => T },
  offset: number,
  limit: number
): Promise<Page<T>> {
  const s = store()
  const keys = (await s.getKeys(prefix)).sort()
  const window = keys.slice(offset, offset + limit)
  const items = await readKeys(window, schema)
  return { items, total: keys.length, offset, limit }
}

/* ----------------------------------------------------------------------------
 * Agents
 * ------------------------------------------------------------------------- */
export async function listAgents(): Promise<Agent[]> {
  const agents = await readAll('agents:', AgentSchema)
  return agents.sort((a, b) => a.ghl.agentName.localeCompare(b.ghl.agentName))
}

export async function getAgent(id: string): Promise<Agent | null> {
  const raw = await store().getItem(`agents:${id}`)
  return raw == null ? null : AgentSchema.parse(raw)
}

export async function upsertAgent(a: Agent): Promise<Agent> {
  const agent = AgentSchema.parse(a)
  await putItem(`agents:${agent.ghl.id}`, agent)
  // Maintain the write-time agents index (overwrite-by-id) so dashboard reads
  // fetch ONE object instead of scanning `agents:<id>` keys. Read-modify-write
  // via getItem — never getKeys.
  await indexAgent(agent)
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
  return calls.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Paginated calls for the table. Sorts newest-first, then windows by
 * offset/limit. The agent filter (when present) is applied BEFORE paging so the
 * window/total reflect the filtered set. This is the bounded read the calls
 * table should use as volume grows; `listCalls` remains for callers that
 * genuinely need every row (e.g. fleet rollup over all calls).
 *
 * NOTE: KV exposes no server-side sort, so ordering still requires reading the
 * matched values. We bound the cost by only materialising the requested window
 * for the unfiltered case; the agent-filtered case must read matching values to
 * know which calls belong to the agent. For O(1) overview reads use the
 * `index:fleet` rollup (getFleetIndex) rather than this call scan.
 */
export async function listCallsPaged(
  opts: { agentId?: string, offset?: number, limit?: number } = {}
): Promise<Page<Call>> {
  const offset = Math.max(0, opts.offset ?? 0)
  const limit = Math.max(1, opts.limit ?? 50)

  // Unfiltered: window the key list directly so we only read the page's values.
  if (!opts.agentId) {
    const s = store()
    const keys = await s.getKeys('calls:')
    // calls:<id> keys aren't time-ordered, so we must read to sort by createdAt.
    // Read all values once, then sort+slice. (Still one getItems transaction.)
    const all = (await readKeys(keys, CallSchema)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit }
  }

  const matched = (await listCalls({ agentId: opts.agentId }))
  return { items: matched.slice(offset, offset + limit), total: matched.length, offset, limit }
}

export async function getCall(id: string): Promise<Call | null> {
  const raw = await store().getItem(`calls:${id}`)
  return raw == null ? null : CallSchema.parse(raw)
}

export async function upsertCall(c: Call): Promise<Call> {
  const call = CallSchema.parse(c)
  await putItem(`calls:${call.id}`, call)
  // Maintain the write-time calls index (overwrite-by-id). Call records are small
  // (no transcript/analysis bodies), so the whole map stays under the size cap.
  // Read-modify-write via getItem — never getKeys.
  await indexCall(call)
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
  // Transcripts are the largest entity — the size guard matters most here.
  await putItem(`transcripts:${transcript.callId}`, transcript)
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
  await putItem(`analyses:${analysis.callId}`, analysis)
  // Keep the write-time rollup index in lockstep so the Overview/Agent-list
  // endpoints can read ONE compact object instead of scanning every analysis.
  // Keyed by callId, so re-analysing a call OVERWRITES its summary (no dupes).
  await indexAnalysis(analysis)
  return analysis
}

export async function listAnalyses(): Promise<Analysis[]> {
  return readAll('analyses:', AnalysisSchema)
}

/* ----------------------------------------------------------------------------
 * Write-time fleet rollup index (`index:fleet`)
 *
 * A single compact record mapping callId -> AnalysisSummary (the small subset of
 * each Analysis the dashboard rollups read). Maintained on every upsertAnalysis
 * so read endpoints fetch O(1) instead of an N-key analyses scan. It is a DERIVED
 * cache: on a miss (fresh KV, or a shape-version bump) callers fall back to a
 * full scan via rebuildFleetIndex(), so correctness never depends on the index
 * existing. The summary itself is tiny (no transcript/timeline/finding bodies),
 * so the whole index stays comfortably under the value-size cap for realistic
 * call volumes; if it ever approaches the cap the putItem guard fails loud.
 * ------------------------------------------------------------------------- */
const FLEET_INDEX_KEY = 'index:fleet'

function emptyFleetIndex(): FleetIndex {
  return { version: FLEET_INDEX_VERSION, summaries: {} }
}

/** Read the fleet index, or null when absent / a stale shape version. */
export async function getFleetIndex(): Promise<FleetIndex | null> {
  const raw = await store().getItem<FleetIndex>(FLEET_INDEX_KEY)
  if (raw == null || typeof raw !== 'object') return null
  if ((raw as FleetIndex).version !== FLEET_INDEX_VERSION) return null
  // Defensive: ensure the summaries map exists even if a partial write landed.
  return { version: FLEET_INDEX_VERSION, summaries: (raw as FleetIndex).summaries ?? {} }
}

/** Upsert one analysis' summary into the index (overwrite-by-callId). */
async function indexAnalysis(analysis: Analysis): Promise<void> {
  const index = (await getFleetIndex()) ?? emptyFleetIndex()
  index.summaries[analysis.callId] = toAnalysisSummary(analysis)
  await putItem(FLEET_INDEX_KEY, index)
}

/**
 * Rebuild the index from a full analyses scan and persist it. The fallback path
 * when the index is missing/stale, and a way to repair drift. Returns the freshly
 * built index so the caller can use it without a second read.
 */
export async function rebuildFleetIndex(): Promise<FleetIndex> {
  const analyses = await listAnalyses()
  const summaries: Record<string, AnalysisSummary> = {}
  for (const a of analyses) summaries[a.callId] = toAnalysisSummary(a)
  const index: FleetIndex = { version: FLEET_INDEX_VERSION, summaries }
  await putItem(FLEET_INDEX_KEY, index)
  return index
}

/**
 * Get the fleet index, rebuilding (and persisting) it from a scan on a miss.
 * This is what the Overview/Agent-list endpoints should call: O(1) on the warm
 * path, self-healing on a cold one.
 */
export async function getOrBuildFleetIndex(): Promise<FleetIndex> {
  return (await getFleetIndex()) ?? rebuildFleetIndex()
}

/* ----------------------------------------------------------------------------
 * Write-time entity indexes (`index:agents`, `index:calls`)
 *
 * These two records are the SOURCE OF TRUTH for the dashboard HOT READ PATH:
 * GET /api/agents, /api/calls, and /api/recommendations read ONLY these getItem
 * records (plus index:fleet) — they NEVER call getKeys / list / readAll. That keeps
 * the dashboard off Cloudflare's free-tier KV `list` quota and makes overview
 * reads O(1) instead of O(N-keys).
 *
 * Both follow the same overwrite-by-id map pattern as index:fleet and are
 * maintained read-modify-write (getItem -> mutate -> putItem, NO getKeys) in
 * upsertAgent / upsertCall. On a miss (absent, non-object, or version mismatch)
 * the getters return an EMPTY map WITHOUT any getKeys/list/rebuild — an empty KV
 * therefore costs ZERO list ops on every read.
 *
 * Migration note: because these are the read source of truth, a KV that already
 * held entities written BEFORE this change must be migrated once via the
 * list-based `reindexAll()` below. Our KV is currently empty, so the indexes
 * populate naturally as the first sync upserts each agent/call — no reindex
 * needed. `reindexAll()` uses getKeys and must NEVER sit on a read path.
 * ------------------------------------------------------------------------- */
const AGENTS_INDEX_KEY = 'index:agents'
const CALLS_INDEX_KEY = 'index:calls'

function emptyAgentsIndex(): AgentsIndex {
  return { version: AGENTS_INDEX_VERSION, agents: {} }
}

function emptyCallsIndex(): CallsIndex {
  return { version: CALLS_INDEX_VERSION, calls: {} }
}

/**
 * Read the agents index. Returns an EMPTY map on any miss (absent / non-object /
 * stale version) using ONLY getItem — never getKeys, never a rebuild. Empty KV is
 * a valid state that costs zero list ops.
 */
export async function getAgentsIndex(): Promise<AgentsIndex> {
  const raw = await store().getItem<AgentsIndex>(AGENTS_INDEX_KEY)
  if (raw == null || typeof raw !== 'object') return emptyAgentsIndex()
  if ((raw as AgentsIndex).version !== AGENTS_INDEX_VERSION) return emptyAgentsIndex()
  // Defensive: ensure the map exists even if a partial write landed.
  return { version: AGENTS_INDEX_VERSION, agents: (raw as AgentsIndex).agents ?? {} }
}

/**
 * Read the calls index. Returns an EMPTY map on any miss using ONLY getItem —
 * never getKeys, never a rebuild.
 */
export async function getCallsIndex(): Promise<CallsIndex> {
  const raw = await store().getItem<CallsIndex>(CALLS_INDEX_KEY)
  if (raw == null || typeof raw !== 'object') return emptyCallsIndex()
  if ((raw as CallsIndex).version !== CALLS_INDEX_VERSION) return emptyCallsIndex()
  return { version: CALLS_INDEX_VERSION, calls: (raw as CallsIndex).calls ?? {} }
}

/** Upsert one agent into the index (overwrite-by-agentId). getItem -> mutate -> putItem. */
async function indexAgent(agent: Agent): Promise<void> {
  const index = await getAgentsIndex()
  index.agents[agent.ghl.id] = agent
  await putItem(AGENTS_INDEX_KEY, index)
}

/** Upsert one call into the index (overwrite-by-callId). getItem -> mutate -> putItem. */
async function indexCall(call: Call): Promise<void> {
  const index = await getCallsIndex()
  index.calls[call.id] = call
  await putItem(CALLS_INDEX_KEY, index)
}

/* ----------------------------------------------------------------------------
 * One-time migration / repair helper. Rebuilds ALL THREE indexes from a full
 * key scan (getKeys). This is the ONLY place an index is built from a scan; it is
 * for manual/migration use ONLY (e.g. a KV that predates these indexes) and MUST
 * NOT be reachable from any read endpoint — it would reintroduce the list-quota
 * cost the indexes exist to avoid.
 * ------------------------------------------------------------------------- */
export async function reindexAll(): Promise<{ agents: number, calls: number, analyses: number }> {
  const [agents, calls] = await Promise.all([
    readAll('agents:', AgentSchema),
    readAll('calls:', CallSchema)
  ])

  const agentsIndex: AgentsIndex = { version: AGENTS_INDEX_VERSION, agents: {} }
  for (const a of agents) agentsIndex.agents[a.ghl.id] = a

  const callsIndex: CallsIndex = { version: CALLS_INDEX_VERSION, calls: {} }
  for (const c of calls) callsIndex.calls[c.id] = c

  const fleetIndex = await rebuildFleetIndex()

  await Promise.all([
    putItem(AGENTS_INDEX_KEY, agentsIndex),
    putItem(CALLS_INDEX_KEY, callsIndex)
  ])

  return {
    agents: agents.length,
    calls: calls.length,
    analyses: Object.keys(fleetIndex.summaries).length
  }
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
  await putItem(`flows:${flow.agentId}`, flow)
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
  await putItem(`timelines:${timeline.callId}`, timeline)
  return timeline
}

/* ----------------------------------------------------------------------------
 * Analysis run status (keyed by callId) — the live, reactive progress record +
 * single-flight guard. Written as the analyze pipeline advances; read by the
 * status endpoint that the call page polls. Tiny record, well under the cap.
 * ------------------------------------------------------------------------- */
export async function getAnalysisStatus(callId: string): Promise<AnalysisStatus | null> {
  const raw = await store().getItem(`analysisStatus:${callId}`)
  if (raw == null) return null
  const parsed = AnalysisStatusSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export async function setAnalysisStatus(status: AnalysisStatus): Promise<AnalysisStatus> {
  const parsed = AnalysisStatusSchema.parse(status)
  await putItem(`analysisStatus:${parsed.callId}`, parsed)
  return parsed
}

/* ----------------------------------------------------------------------------
 * Generic settings (keyed by an arbitrary settings key, e.g. 'settings:llm').
 * Used by the LLM config layer to persist Settings-UI overrides (provider +
 * per-role model selection + write-only API keys) OVER the runtimeConfig
 * defaults. Returns the raw stored object; the caller validates/merges.
 * ------------------------------------------------------------------------- */
export async function getSetting<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const raw = await store().getItem(`settings:${key}`)
  return raw == null ? null : (raw as T)
}

export async function setSetting(key: string, value: Record<string, unknown>): Promise<void> {
  await putItem(`settings:${key}`, value)
}
