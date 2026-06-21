import type {
  Agent,
  AgentHealth,
  Analysis,
  CallDetail,
  CallListItem,
  ExpectedFlow,
  FleetStats,
  RecommendationItem
} from '#shared/types'

/** Resolved GHL/runtime context for the Settings screen (GET /api/context). */
export interface AppContext {
  locationId?: string
  userId?: string
  email?: string
  userName?: string
  role?: string
  type?: string
}

/** Result of POSTing /api/sync (poll + ingest GHL call logs). */
export interface SyncResult {
  ingested: number
  errors?: string[]
}

/** Aggregate flow-drift across an agent's analyzed calls. */
export interface FlowDriftSummary {
  avgConformance: number | null
  callsScored: number
  nodes: { nodeId: string, label: string, kind: string, skipRate: number, driftRate: number }[]
}

/** One agent's drill-down payload from GET /api/agents/:id. */
export interface AgentDetail {
  health: AgentHealth
  calls: CallListItem[]
  recommendations: RecommendationItem[]
  flowSummary: FlowDriftSummary
}

/** Typed $fetch wrappers around the Nitro API surface. */
export function useApi() {
  return {
    /** Fleet-wide rollup for the Overview screen. */
    getFleet: () => $fetch<FleetStats>('/api/agents'),

    /** Single agent health + calls + recommendations. */
    getAgent: (id: string) => $fetch<AgentDetail>(`/api/agents/${id}`),

    /**
     * Fleet-wide recommendations fix-queue, ranked by impact then recency. Each
     * item carries its source call/agent so the list can deep-link to origin.
     * Optional `agentId` scopes the queue to one agent.
     */
    getRecommendations: (query?: { agentId?: string }) =>
      $fetch<RecommendationItem[]>('/api/recommendations', { query }),

    /** Filterable call list. */
    getCalls: (query?: { agentId?: string, severity?: string, outcome?: string }) =>
      $fetch<CallListItem[]>('/api/calls', { query }),

    /** Full call detail: call + agent + transcript + analysis. */
    getCall: (id: string) => $fetch<CallDetail>(`/api/calls/${id}`),

    /** Run / re-run analysis for one call. */
    analyzeCall: (callId: string, force = false) =>
      $fetch<Analysis>(`/api/analyze/${callId}`, { method: 'POST', body: { force } }),

    /** The agent's expected call flow (lazily generated on first read). */
    getAgentFlow: (id: string) => $fetch<ExpectedFlow>(`/api/agents/${id}/flow`),

    /** Create an agent; the server derives criteria + expected flow at creation. */
    createAgent: (body: { name: string, goal: string, script?: string }) =>
      $fetch<{ agent: Agent, flow: ExpectedFlow }>('/api/agents', { method: 'POST', body }),

    /** Load the demo dataset. */
    seed: () => $fetch<{ agents: number, calls: number }>('/api/seed', { method: 'POST' }),

    /**
     * Poll GHL Voice AI call-logs and ingest new calls/transcripts (Settings →
     * "Sync calls from HighLevel"). Degrades gracefully: returns a structured
     * { ingested, errors } instead of throwing when no PIT/location is configured.
     */
    syncCalls: (body?: { locationId?: string }) =>
      $fetch<SyncResult>('/api/sync', { method: 'POST', body: body ?? {} }),

    /** Resolve the GHL/runtime context (location + user) for the Settings screen. */
    getContext: (query?: { encryptedData?: string, locationId?: string }) =>
      $fetch<AppContext>('/api/context', { query })
  }
}

export type { Agent }
