// BORROWED (mirrors GHL)
/**
 * PIT-authenticated GoHighLevel Voice AI REST client + mappers (M2 sync layer).
 *
 * This is a READ-ONLY mirror of the live HighLevel API, verified end-to-end
 * against a real sandbox (see platform.md + docs/captures/). Auth is a Private
 * Integration Token (Bearer) plus the required `Version: v3` header.
 *
 * Endpoints (platform.md §3):
 *   GET /voice-ai/agents                          -> { agents[], … }
 *   GET /voice-ai/agents/:id                      -> full agent config
 *   GET /agent-studio/agents/versions/:versionId  -> { success, message, version }
 *   GET /voice-ai/dashboard/call-logs             -> { callLogs[], totalRecords, traceId }
 *
 * Mappers project the RAW GHL shapes (shared/ghl.ts) into the normalized domain
 * the eval layer consumes:
 *   mapFlowVersion : GhlFlowVersionRaw     -> FlowGraph (Vue-Flow-shaped; uiNodes -> position)
 *   mapCallLog     : GhlCallLog            -> { call: Call, transcript: Transcript }
 *                    transcriptWithToolCalls -> TranscriptEntry[] (agent->agent, user->customer,
 *                    action_executed->action), with REAL per-turn latency computed from times.
 *
 * Every field here traces to a captured payload; nothing is invented. The flat
 * `transcript` string is used ONLY as a fallback when transcriptWithToolCalls is
 * empty (platform.md §4 — it is lossy: irregular spacing, template artifacts,
 * non-alternating turns).
 */
import type {
  Agent,
  GhlAgent,
  GhlCallLog,
  GhlFlowVersionRaw,
  GhlRawNode,
  GhlRawEdge,
  GhlUiNode,
  FlowGraph,
  FlowNode,
  FlowNodeType,
  FlowEdge,
  FlowTransition,
  Call,
  Transcript,
  TranscriptEntry,
  PerTurnLatency,
  CallType
} from '#shared/types'
import {
  GhlAgentSchema,
  GhlCallLogsResponseSchema,
  GhlFlowVersionResponseSchema,
  FlowGraphSchema,
  CallSchema,
  TranscriptSchema
} from '#shared/types'

/** ⚠️ platform.md §2: the Voice AI APIs want `Version: v3` (not 2021-07-28). */
const GHL_API_VERSION = 'v3'

export interface GhlClientConfig {
  apiBase: string
  pitToken: string
  /** Sub-account location id — REQUIRED as a query param on agent/flow reads
   * (the live API returns 400 "LocationId is missing in query" without it,
   * even with a location-scoped PIT). */
  locationId: string
}

function authHeaders(cfg: GhlClientConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.pitToken}`,
    Version: GHL_API_VERSION,
    Accept: 'application/json'
  }
}

/**
 * Thin fetch wrapper. Throws on non-2xx so callers (sync routes) can collect the
 * error string; never swallows here so the failure is visible upstream.
 */
async function ghlFetch<T>(
  cfg: GhlClientConfig,
  path: string,
  query?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), cfg.apiBase.replace(/\/$/, '') + '/')
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { headers: authHeaders(cfg) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `GHL ${res.status} ${res.statusText} for ${path}${body ? `: ${body.slice(0, 300)}` : ''}`
    )
  }
  return res.json() as Promise<T>
}

export function createGhlClient(cfg: GhlClientConfig) {
  return {
    /**
     * List Voice AI agents for the configured location. Resilient: each agent is
     * validated INDIVIDUALLY, so one malformed/draft agent (e.g. missing fields)
     * no longer fails the whole list — the valid agents still sync. (The strict
     * whole-array parse previously made a single draft agent return zero agents.)
     */
    async listAgents(): Promise<GhlAgent[]> {
      const data = await ghlFetch<unknown>(cfg, 'voice-ai/agents', { locationId: cfg.locationId })
      const obj = (data && typeof data === 'object' ? (data as Record<string, unknown>) : {})
      const list = Array.isArray(obj.agents) ? obj.agents : []
      const agents: GhlAgent[] = []
      for (const item of list) {
        const parsed = GhlAgentSchema.safeParse(item)
        if (parsed.success) agents.push(parsed.data)
        else {
          const id = (item as { id?: string })?.id ?? 'unknown'
          console.warn(`[ghl.listAgents] skipping unparseable agent ${id}: ${parsed.error.message}`)
        }
      }
      return agents
    },

    /** Fetch a single agent's full config by id (resolves call.agentId). */
    async getAgent(id: string): Promise<GhlAgent> {
      const data = await ghlFetch<unknown>(cfg, `voice-ai/agents/${encodeURIComponent(id)}`, { locationId: cfg.locationId })
      // The detail endpoint may return the agent bare or wrapped — unwrap both.
      const obj = (data && typeof data === 'object' ? (data as Record<string, unknown>) : {}) as Record<string, unknown>
      const raw = (obj.agent ?? obj.data ?? obj) as unknown
      return GhlAgentSchema.parse(raw)
    },

    /**
     * Fetch the Agent Studio flow version (the design DAG) for an `llmVersionId`,
     * normalized to our Vue-Flow-shaped FlowGraph.
     * GET /agent-studio/agents/versions/:versionId -> { success, message, version }
     */
    async getFlowVersion(versionId: string): Promise<FlowGraph> {
      const data = await ghlFetch<unknown>(
        cfg,
        `agent-studio/agents/versions/${encodeURIComponent(versionId)}`,
        { locationId: cfg.locationId }
      )
      const parsed = GhlFlowVersionResponseSchema.parse(data)
      return mapFlowVersion(parsed.version)
    },

    /**
     * List Voice AI call logs for a location. Ingest from this LIST endpoint —
     * it carries the full `transcriptWithToolCalls` (the detail endpoint drops
     * it). Returns the de-enveloped, schema-validated logs.
     *
     * ⚠️ Cloudflare bound: the deployment runs on Workers (≈30s CPU budget,
     * 1000-subrequest ceiling). Each list page is one subrequest, and downstream
     * each ingested call can fan out to several Claude calls in the analysis
     * pass. The DEFAULT `maxPages` is therefore a conservative 4 (≤200 calls per
     * sync); a full backfill must opt in by passing a larger `opts.maxPages`.
     *
     * `callType` is parameterized (default `'TRIAL'` — the sandbox is trial-only)
     * so a production location can ingest `'LIVE'` (or pass `undefined` to omit
     * the filter and get whatever the API returns) without editing this client.
     *
     * `onPage` (optional, may be async) is invoked with each page's NEW
     * (not-yet-seen-in-THIS-run) logs as they arrive, BEFORE the next page is
     * fetched; resolving to `false` stops pagination early. Callers ingest in
     * the callback and signal "stop, whole page already ingested-and-unchanged"
     * for incremental sync that doesn't re-walk history every time.
     */
    async listCallLogs(
      locationId: string,
      opts?: {
        pageSize?: number
        maxPages?: number
        agentId?: string
        callType?: CallType | undefined
        onPage?: (newLogs: GhlCallLog[], page: number) => boolean | void | Promise<boolean | void>
      }
    ): Promise<GhlCallLog[]> {
      const pageSize = Math.min(Math.max(opts?.pageSize ?? 50, 1), 50) // GHL caps at 50
      // Conservative default to stay within the Cloudflare subrequest/CPU
      // budget; an explicit override (manual backfill) raises the ceiling.
      const maxPages = Math.max(opts?.maxPages ?? 4, 1)
      // `callType` defaults to TRIAL; pass null/undefined explicitly to omit.
      const callType = opts && 'callType' in opts ? opts.callType : 'TRIAL'
      const all: GhlCallLog[] = []
      const seen = new Set<string>()

      for (let page = 1; page <= maxPages; page++) {
        const data = await ghlFetch<unknown>(cfg, 'voice-ai/dashboard/call-logs', {
          locationId,
          page,
          pageSize,
          callType,
          agentId: opts?.agentId
        })
        const { callLogs } = GhlCallLogsResponseSchema.parse(data)
        if (callLogs.length === 0) break
        const newLogs: GhlCallLog[] = []
        for (const log of callLogs) {
          if (seen.has(log.id)) continue
          seen.add(log.id)
          all.push(log)
          newLogs.push(log)
        }
        if (opts?.onPage) {
          const cont = await opts.onPage(newLogs, page)
          if (cont === false) break // caller signalled "stop, page fully seen"
        }
        if (callLogs.length < pageSize) break // last page
      }
      return all
    }
  }
}

/**
 * Fetch + map a single GHL agent into our enriched domain `Agent` (borrowed
 * config + normalized flow graph), WITHOUT success criteria — that derivation is
 * the eval layer's concern and is enriched separately by the agents/sync route.
 *
 * Shared by `/api/agents/sync` (bulk mirror) and `/api/sync`'s auto-sync
 * fallback (when a call references an agent that was never synced), so the
 * agent-build logic lives in exactly one place. Throws on a missing
 * `llmVersionId` or any fetch/mapping failure so callers surface it loudly.
 */
export async function buildAgentFromGhl(
  client: GhlClient,
  ghl: GhlAgent,
  syncedAt: string
): Promise<Agent> {
  let flow: FlowGraph
  if (ghl.llmVersionId) {
    flow = await client.getFlowVersion(ghl.llmVersionId)
    // The flow version's agentId is the Agent Studio agent id, not the voice agent
    // id — stamp our join key (call.agentId == GhlAgent.id) onto it.
    flow.agentId = ghl.id
  } else {
    // No published Agent-Studio flow version yet (a freshly-created / draft agent).
    // Mirror it anyway with an empty borrowed flow — the intended-flow + drift
    // analysis is derived from the agent's PROMPT, not this graph, so the agent is
    // still fully analyzable. The graph backfills once it's published in GHL.
    flow = { versionId: '', agentId: ghl.id, isPublished: false, nodes: [], edges: [], globalVariables: [] }
  }
  return {
    ghl,
    flow,
    successCriteria: [],
    syncedAt
  }
}

export type GhlClient = ReturnType<typeof createGhlClient>

/* ============================================================================
 * Flow-version mapper: GhlFlowVersionRaw -> normalized FlowGraph.
 *
 * Collapses GHL's richer node vocabulary into the five canonical types and
 * pulls geometry from uiNodes (falling back to a deterministic layout when a
 * logical node has no uiNode entry — observed: router/action nodes lacked one
 * in 40-flow-version.json). Edges carry label + a stringified condition.
 * ========================================================================== */

/** Resolve a raw node's GHL type vocabulary down to our 5 FlowNodeType values. */
export function resolveNodeType(node: GhlRawNode): FlowNodeType {
  const fe = (node.frontendNodeType ?? '').toLowerCase()
  const nt = (node.nodeType ?? '').toLowerCase()
  const name = (node.nodeName ?? '').toLowerCase()

  // endCall first — distinguishable by nodeType or name even though GHL marks
  // many leaf nodes isEndNode=true.
  if (nt === 'endcallnode' || fe === 'end-call' || name.includes('end_call') || name.includes('endcall')) {
    return 'endCall'
  }
  if (fe === 'start-action' || nt === 'triggernode' || node.isStartNode) return 'trigger'
  if (fe === 'llm' || nt === 'llmnode') return 'llm'
  if (fe === 'ai-router' || nt === 'routernode' || name.includes('router')) return 'router'
  if (fe === 'actions' || nt === 'actionnode' || name.startsWith('action')) return 'action'
  // universalNode with an unknown subtype → infer from nodeConfig.type.
  const cfgType = String((node.nodeConfig as Record<string, unknown>)?.type ?? '').toLowerCase()
  if (cfgType === 'ai-router' || cfgType === 'router') return 'router'
  if (cfgType === 'actions') return 'action'
  // Safe default: treat an unrecognized node as an llm step (the dominant kind).
  return 'llm'
}

/** Stringify a raw edge's machine condition block (e.g. `tool_name EQ router`). */
function stringifyCondition(edge: GhlRawEdge): string | undefined {
  const c = edge.conditions
  if (!c || !Array.isArray(c.rules) || c.rules.length === 0) return undefined
  const parts = c.rules.map(r => `${r.operand} ${r.operator} ${String(r.value)}`)
  return parts.join(` ${c.type ?? 'AND'} `)
}

/** Best-effort string-array of tool ids attached to an llm/action node. */
function pickTools(node: GhlRawNode): string[] | undefined {
  const tools = (node.nodeConfig as Record<string, unknown>)?.tools
  if (Array.isArray(tools)) {
    const out = tools.map(String).filter(Boolean)
    return out.length > 0 ? out : undefined
  }
  return undefined
}

/** Pull an llm node's system prompt from nodeConfig. */
function pickPrompt(node: GhlRawNode): string | undefined {
  const p = (node.nodeConfig as Record<string, unknown>)?.prompt
  return typeof p === 'string' && p.length > 0 ? p : undefined
}

/**
 * Map raw flow version → FlowGraph. `uiNodes[].position` drives layout; nodes
 * absent from uiNodes (real gap in the capture) get a deterministic fallback
 * grid so the DAG still renders without overlap.
 */
export function mapFlowVersion(raw: GhlFlowVersionRaw): FlowGraph {
  const uiById = new Map<string, GhlUiNode>()
  for (const u of raw.uiNodes) uiById.set(u.id, u)

  // Outgoing edges per source node → drive each node's `transitions`.
  const outgoing = new Map<string, GhlRawEdge[]>()
  for (const e of raw.edges) {
    const arr = outgoing.get(e.source) ?? []
    arr.push(e)
    outgoing.set(e.source, arr)
  }

  let fallbackIdx = 0
  const nodes: FlowNode[] = raw.nodes.map((n) => {
    const ui = uiById.get(n.nodeId)
    // uiNode carries `position`; fall back to computedPosition, then a grid slot.
    const uiPos = ui?.position as { x?: number, y?: number } | undefined
    const computed = (ui as Record<string, unknown> | undefined)?.computedPosition as
      | { x?: number, y?: number }
      | undefined
    const position
      = uiPos && typeof uiPos.x === 'number' && typeof uiPos.y === 'number'
        ? { x: uiPos.x, y: uiPos.y }
        : computed && typeof computed.x === 'number' && typeof computed.y === 'number'
          ? { x: computed.x, y: computed.y }
          : { x: 280 * (fallbackIdx % 3), y: 200 * Math.floor(fallbackIdx / 3) + 120 }
    if (!ui) fallbackIdx++

    const transitions: FlowTransition[] = (outgoing.get(n.nodeId) ?? []).map((e) => {
      const cond = stringifyCondition(e)
      const t: FlowTransition = { condition: e.label ?? cond ?? '' }
      if (e.target) t.to = e.target
      // surface the tool the branch is gated on, when the condition is tool_name EQ <x>.
      const toolRule = e.conditions?.rules?.find(r => r.operand === 'tool_name')
      if (toolRule && toolRule.value != null) t.toolName = String(toolRule.value)
      return t
    })

    const node: FlowNode = {
      id: n.nodeId,
      type: resolveNodeType(n),
      position,
      data: {
        displayName: n.nodeDisplayName || n.nodeName || n.nodeId,
        isStart: Boolean(n.isStartNode),
        isEnd: Boolean(n.isEndNode),
        ...(pickPrompt(n) ? { prompt: pickPrompt(n) } : {}),
        ...(pickTools(n) ? { tools: pickTools(n) } : {}),
        ...(transitions.length > 0 ? { transitions } : {})
      }
    }
    return node
  })

  const edges: FlowEdge[] = raw.edges.map((e) => {
    const cond = stringifyCondition(e)
    const edge: FlowEdge = { id: e.id, source: e.source, target: e.target }
    if (e.label) edge.label = e.label
    if (cond) edge.condition = cond
    return edge
  })

  return FlowGraphSchema.parse({
    versionId: raw.versionId,
    agentId: raw.agentId ?? '',
    isPublished: Boolean(raw.isPublished),
    nodes,
    edges,
    ...(raw.viewport ? { viewport: raw.viewport } : {}),
    globalVariables: raw.globalVariables ?? []
  })
}

/* ============================================================================
 * Call-log mapper: GhlCallLog -> { Call, Transcript } + per-turn latency.
 * ========================================================================== */

/** GHL turn role -> our normalized speaker (platform.md §10: agent=AI, user=caller). */
function mapRole(role: 'agent' | 'user'): 'agent' | 'customer' {
  return role === 'agent' ? 'agent' : 'customer'
}

/**
 * Project `transcriptWithToolCalls` into normalized TranscriptEntry[]. Times are
 * GHL seconds (float); we keep seconds on the transcript (the eval layer reads
 * startSec/endSec) and compute ms latency separately. Entry `idx` is the index
 * into this array — the citation key used by findings/conformance.
 */
export function mapTranscriptEntries(log: GhlCallLog): TranscriptEntry[] {
  const src = log.transcriptWithToolCalls ?? []
  const entries: TranscriptEntry[] = []
  src.forEach((e, idx) => {
    if (e.role === 'action_executed') {
      entries.push({
        idx,
        role: 'action',
        toolName: e.toolName,
        toolType: e.toolType,
        toolCallId: e.toolCallId,
        atSec: e.startTime
      })
    } else {
      entries.push({
        idx,
        role: mapRole(e.role),
        content: e.content,
        startSec: e.startTime,
        endSec: e.endTime
      })
    }
  })
  return entries
}

/**
 * REAL per-turn response latency: for each agent turn, the gap from the
 * immediately-preceding customer turn's `endSec` to this agent turn's `startSec`
 * (platform.md §8 — measured 1086–1812 ms on Call A). Negative gaps (barge-in /
 * overlap) are clamped to 0 but still counted as a turn.
 */
export function computePerTurnLatency(entries: TranscriptEntry[]): PerTurnLatency[] {
  const out: PerTurnLatency[] = []
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i]
    if (!cur || cur.role !== 'agent') continue
    // walk back to the nearest customer turn.
    let prevCustomerIdx = -1
    for (let j = i - 1; j >= 0; j--) {
      const p = entries[j]
      if (p && p.role === 'customer') {
        prevCustomerIdx = j
        break
      }
      if (p && p.role === 'agent') break // a prior agent turn → not a response gap
    }
    if (prevCustomerIdx < 0) continue
    const prev = entries[prevCustomerIdx]
    if (!prev || prev.role !== 'customer' || cur.role !== 'agent') continue
    const latencyMs = Math.max(0, Math.round((cur.startSec - prev.endSec) * 1000))
    out.push({ agentEntryIdx: cur.idx, customerEntryIdx: prev.idx, latencyMs })
  }
  return out
}

/** Fallback parser for the lossy flat `transcript` string (bot:/human: prefixes). */
function parseFlatTranscript(raw: string): TranscriptEntry[] {
  const lines = raw.split(/\r?\n+/).map(l => l.trim()).filter(Boolean)
  const entries: TranscriptEntry[] = []
  lines.forEach((line) => {
    const m = line.match(/^(bot|agent|assistant|human|user|customer|caller)\s*:\s*(.*)$/i)
    const idx = entries.length
    if (m) {
      const tag = m[1]!.toLowerCase()
      const role: 'agent' | 'customer' = ['bot', 'agent', 'assistant'].includes(tag) ? 'agent' : 'customer'
      entries.push({ idx, role, content: m[2]!.trim(), startSec: 0, endSec: 0 })
    } else {
      // no prefix — alternate, agent first.
      entries.push({ idx, role: idx % 2 === 0 ? 'agent' : 'customer', content: line, startSec: 0, endSec: 0 })
    }
  })
  return entries
}

/**
 * Map a GHL call-log LIST item into our `{ call, transcript }`. Prefers
 * `transcriptWithToolCalls`; falls back to the flat `transcript` string only
 * when the structured array is empty.
 */
export function mapCallLog(
  log: GhlCallLog,
  source: 'poll' | 'webhook' | 'seed' = 'poll'
): { call: Call, transcript: Transcript } {
  const callType: CallType = log.trialCall ? 'TRIAL' : 'LIVE'
  const createdAt = (() => {
    const d = new Date(log.createdAt)
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  })()

  const call = CallSchema.parse({
    id: log.id,
    agentId: log.agentId,
    ...(log.contactId ? { contactId: log.contactId } : {}),
    createdAt,
    durationSec: Math.max(0, Number(log.duration) || 0),
    callType,
    source,
    ...(log.summary ? { summary: log.summary } : {})
  })

  let entries = mapTranscriptEntries(log)
  if (entries.length === 0 && typeof log.transcript === 'string' && log.transcript.trim()) {
    entries = parseFlatTranscript(log.transcript)
  }
  const transcript = TranscriptSchema.parse({ callId: log.id, entries })

  return { call, transcript }
}
