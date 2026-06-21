import type {
  Agent,
  AgentHealth,
  Analysis,
  CallDetail,
  CallListItem,
  ExpectedFlow,
  FleetStats,
  Recommendation
} from '#shared/types'

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
  recommendations: Recommendation[]
  flowSummary: FlowDriftSummary
}

/** Typed $fetch wrappers around the Nitro API surface. */
export function useApi() {
  return {
    /** Fleet-wide rollup for the Overview screen. */
    getFleet: () => $fetch<FleetStats>('/api/agents'),

    /** Single agent health + calls + recommendations. */
    getAgent: (id: string) => $fetch<AgentDetail>(`/api/agents/${id}`),

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
    seed: () => $fetch<{ agents: number, calls: number }>('/api/seed', { method: 'POST' })
  }
}

export type { Agent }
