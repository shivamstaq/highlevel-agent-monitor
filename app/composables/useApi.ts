// CREATED (our eval layer) — typed client over the rebuilt Nitro API surface.
/**
 * useApi — the single typed `$fetch` client the dashboard uses. Every method is
 * pinned to a real server route under `server/api/**` and typed from the
 * `#shared/types` contract (the source of truth). Downstream pages/components
 * MUST call these methods rather than hand-rolling `$fetch`, so route + shape
 * changes flow from one place.
 *
 * Route map (verified against server/api):
 *   getFleet()               GET  /api/agents               -> FleetStats
 *   getAgentDetail(id)       GET  /api/agents/:id           -> AgentDetail
 *   syncAgents(body?)        POST /api/agents/sync          -> SyncAgentsResult
 *   syncCalls(body?)         POST /api/sync                 -> SyncCallsResult
 *   getCalls(filters?)       GET  /api/calls                -> CallListItem[]
 *   getCall(id)              GET  /api/calls/:id            -> CallDetail
 *   analyze(callId, force?)  POST /api/analyze/:callId      -> Analysis
 *   getRecommendations(q?)   GET  /api/recommendations      -> RecommendationItem[]
 *   getContext(q?)           GET  /api/context              -> AppContext
 *   getSettings()            GET  /api/settings             -> LlmSettings
 *   saveSettings(body)       POST /api/settings             -> LlmSettings
 */
import type {
  Agent,
  AgentHealth,
  Analysis,
  AnalysisStatus,
  CallDetail,
  CallListItem,
  CallType,
  FleetStats,
  InferredFlow,
  NodeStatus,
  RecommendationItem,
  Severity
} from '#shared/types'

/* ============================================================================
 * Client-facing response shapes that are NOT in #shared/types because they are
 * route-composition envelopes (the server route's return type). Mirrored here
 * 1:1 from the handlers so the client stays honest about what the API returns.
 * ========================================================================== */

/** One criterion's aggregate performance across the agent's analyzed calls. */
export interface CriterionAggregate {
  criterionId: string
  label: string
  kind: string
  avgScore: number | null
  metRate: number | null
  callsScored: number
}

/** GET /api/agents/:id — one agent's drill-down payload. */
export interface AgentDetail {
  agent: Agent
  health: AgentHealth
  calls: CallListItem[]
  recommendations: RecommendationItem[]
  /** The agent's LLM-inferred intended call flow (happy-path, no drift). */
  inferredFlow: InferredFlow | null
  /** Per-criterion aggregate scorecard across analyzed calls. */
  criteriaScorecard: CriterionAggregate[]
}

/** One mirrored agent in the sync result. */
export interface SyncedAgentResult {
  agentId: string
  agentName: string
  flowNodes: number
  flowEdges: number
}

/** POST /api/agents/sync — mirror agents + flow graphs from GHL. */
export interface SyncAgentsResult {
  synced: number
  agents: SyncedAgentResult[]
  errors?: string[]
}

/**
 * POST /api/sync — poll + ingest GHL call logs, then opportunistically analyze a
 * bounded first batch. Mirrors the server route 1:1 (server/api/sync.post.ts):
 *   · `analyzed`        — calls scored inline during this sync.
 *   · `pendingAnalysis` — ingested call ids deferred to on-demand /api/analyze/:id
 *     (over the inline budget, the agent wasn't synced, or analysis errored).
 *   · `errors`          — collected (non-fatal) failures, surfaced in the UI.
 */
export interface SyncCallsResult {
  ingested: number
  skipped: number
  analyzed: number
  pendingAnalysis: string[]
  errors?: string[]
}

/** Resolved GHL/runtime context for the Settings screen (GET /api/context). */
export interface AppContext {
  locationId?: string
  userId?: string
  email?: string
  userName?: string
  role?: string
  type?: string
}

/**
 * Provider id for the analysis-engine SELECTION (mirrors server LlmProviderId) —
 * the configurable provider an operator can pick.
 */
export type LlmProviderId = 'mock' | 'anthropic' | 'openai' | 'ollama'

/**
 * Provenance provider id carried on an Analysis (analysis.provider). A superset
 * of the selectable providers: it also includes the honesty sentinels written
 * when deterministic fallback stood in for a real provider call —
 *   · 'none'         — the catch-all fallback inside the analysis assembler.
 *   · 'misconfigured'— a real cloud provider was selected but its key was empty,
 *     so buildProvider threw and generateStructured returned flagged fallback.
 * The UI treats every sentinel (plus 'mock') as a non-Claude state.
 */
export type AnalysisProviderId = LlmProviderId | 'none' | 'misconfigured'

/** analysis.provider values that mean "NOT real Claude output" (honesty badge). */
export const FALLBACK_PROVIDERS: readonly AnalysisProviderId[] = ['mock', 'none', 'misconfigured']

/**
 * True when an Analysis did NOT come from a live reasoner — either it explicitly
 * flagged `usedFallback`, or its provenance provider is one of the fallback
 * sentinels. The single source of truth for the "Deterministic fallback" badge
 * on the call + agent detail pages.
 */
export function isFallbackAnalysis(
  a: { usedFallback?: boolean, provider?: string } | null | undefined
): boolean {
  if (!a) return false
  if (a.usedFallback === true) return true
  return FALLBACK_PROVIDERS.includes(a.provider as AnalysisProviderId)
}

/**
 * GET /api/settings — the effective, NON-SECRET analysis-engine config. API keys
 * are write-only: only their presence is surfaced (`anthropicKeySet` /
 * `openaiKeySet`), never the value. Mirrors the server route 1:1.
 */
export interface LlmSettings {
  provider: LlmProviderId
  reasonerModel: string
  labelerModel: string
  ollamaBaseUrl: string
  ollamaModel: string
  anthropicKeySet: boolean
  openaiKeySet: boolean
}

/**
 * POST /api/settings body. Selection fields overwrite; keys are write-only —
 * send a non-empty value only to set/replace a key, omit/blank to leave it.
 */
export interface SaveLlmSettings {
  provider?: LlmProviderId
  reasonerModel?: string
  labelerModel?: string
  anthropicKey?: string
  openaiKey?: string
  ollamaBaseUrl?: string
  ollamaModel?: string
}

/** Filters for GET /api/calls. `callType` replaces the retired `outcome`. */
export interface CallFilters {
  agentId?: string
  severity?: Severity
  callType?: CallType
}

/** Typed `$fetch` wrappers around the rebuilt Nitro API surface. */
export function useApi() {
  return {
    /** Fleet-wide rollup for the Overview screen. */
    getFleet: () => $fetch<FleetStats>('/api/agents'),

    /** One agent's health + calls + recommendations + flow-drift summary. */
    getAgentDetail: (id: string) => $fetch<AgentDetail>(`/api/agents/${id}`),

    /** Mirror Voice AI agents + their flow graphs from GHL (read/mirror, no write-back). */
    syncAgents: (body?: { locationId?: string, agentIds?: string[] }) =>
      $fetch<SyncAgentsResult>('/api/agents/sync', { method: 'POST', body: body ?? {} }),

    /** Derive (or return cached) the agent's intended call flow from its prompt. */
    inferAgentFlow: (id: string) =>
      $fetch<InferredFlow>(`/api/agents/${id}/flow`, { method: 'POST' }),

    /** Poll GHL call-logs and ingest new calls + transcripts (REAL latency timeline). */
    syncCalls: (body?: { locationId?: string, agentId?: string }) =>
      $fetch<SyncCallsResult>('/api/sync', { method: 'POST', body: body ?? {} }),

    /** Filterable call list (agentId / severity / callType). */
    getCalls: (filters?: CallFilters) =>
      $fetch<CallListItem[]>('/api/calls', { query: filters }),

    /** Full call detail: call + agent + transcript + analysis + the three DAGs. */
    getCall: (id: string) => $fetch<CallDetail>(`/api/calls/${id}`),

    /** Run / re-run the eval pipeline for one call. `force` bypasses the hash cache.
     *  Throws a 409 (with the live AnalysisStatus in `data`) if already running. */
    analyze: (callId: string, force = false) =>
      $fetch<Analysis>(`/api/analyze/${callId}`, { method: 'POST', body: { force } }),

    /** Live step-by-step status of a call's analysis run (null if never run). */
    analyzeStatus: (callId: string) =>
      $fetch<AnalysisStatus | null>(`/api/analyze/${callId}/status`),

    /** Fleet-wide recommendations fix-queue, ranked by impact then recency. */
    getRecommendations: (query?: { agentId?: string }) =>
      $fetch<RecommendationItem[]>('/api/recommendations', { query }),

    /** Resolve the GHL/runtime context (location + user) for the Settings screen. */
    getContext: (query?: { encryptedData?: string, locationId?: string }) =>
      $fetch<AppContext>('/api/context', { query }),

    /** Effective analysis-engine config (provider + per-role models + key presence). */
    getSettings: () => $fetch<LlmSettings>('/api/settings'),

    /** Persist analysis-engine config. Keys are write-only (send non-empty to set). */
    saveSettings: (body: SaveLlmSettings) =>
      $fetch<LlmSettings>('/api/settings', { method: 'POST', body })
  }
}

// Re-export the conformance status type so consumers building overlay maps for
// <FlowCanvas> can import it alongside the client without a second import line.
export type { NodeStatus }
