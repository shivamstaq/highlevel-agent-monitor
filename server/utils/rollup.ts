/**
 * Shared aggregation helpers for the read API.
 *
 * These functions turn the flat stored entities (Agent / Call / Analysis) into
 * the composite shapes the dashboard consumes (AgentHealth / FleetStats /
 * CallListItem). They are pure: given the raw rows they compute the rollups, so
 * they are trivially testable and tolerate calls that have not been analyzed yet
 * (score null, topSeverity null).
 */
import type {
  Agent,
  AgentHealth,
  Analysis,
  Call,
  CallListItem,
  FleetStats,
  Recommendation,
  RecommendationItem,
  Severity
} from '#shared/types'

/** A call is a "failure" if it scored below this, or carries a high finding. */
const FAILURE_SCORE_THRESHOLD = 60

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 }

/** Does this analysis carry at least one high-severity finding? */
function hasHighSeverityFailure(analysis: Analysis): boolean {
  return analysis.findings.some(f => f.severity === 'high')
}

/** A call counts as a failure when scored < 60 or it has a high-severity finding. */
function isFailure(analysis: Analysis): boolean {
  return analysis.scorecard.overall < FAILURE_SCORE_THRESHOLD || hasHighSeverityFailure(analysis)
}

/** Highest finding severity in an analysis, or null when there are no findings. */
function topSeverityOf(analysis: Analysis | null): Severity | null {
  if (!analysis || analysis.findings.length === 0) return null
  return analysis.findings.reduce<Severity>((top, f) => {
    return SEVERITY_RANK[f.severity] > SEVERITY_RANK[top] ? f.severity : top
  }, 'low')
}

/** `YYYY-MM-DD` portion of an ISO timestamp (used to bucket the trend chart). */
function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Flatten one call + its (optional) analysis into the list-item the table renders.
 * agentName is resolved by the caller via the agent map so this stays pure.
 */
export function toCallListItem(
  call: Call,
  agentName: string,
  analysis: Analysis | null
): CallListItem {
  return {
    call,
    agentName,
    score: analysis ? analysis.scorecard.overall : null,
    topSeverity: topSeverityOf(analysis),
    findingCount: analysis ? analysis.findings.length : 0
  }
}

/**
 * Roll up a single agent's calls + analyses into its health summary.
 * Only analyzed calls contribute to avgScore / failureRate; an agent with no
 * analyzed calls reports avgScore 0 and failureRate 0 (a neutral baseline).
 */
export function computeAgentHealth(
  agent: Agent,
  calls: Call[],
  analysesByCallId: Map<string, Analysis>
): AgentHealth {
  const analyzed: Analysis[] = []
  for (const call of calls) {
    const a = analysesByCallId.get(call.id)
    if (a) analyzed.push(a)
  }

  const callsAnalyzed = analyzed.length
  const avgScore = callsAnalyzed
    ? analyzed.reduce((sum, a) => sum + a.scorecard.overall, 0) / callsAnalyzed
    : 0
  const failures = analyzed.filter(isFailure).length
  const failureRate = callsAnalyzed ? failures / callsAnalyzed : 0
  const openUseActions = analyzed.reduce((sum, a) => sum + a.useActions.length, 0)

  // Flow adherence: mean conformanceScore over the calls that carry a flow
  // alignment. Stays null when none are scored so the UI can show "—" rather
  // than a fabricated 0 (P11).
  const scoredForFlow = analyzed.filter(a => a.flowAlignment)
  const avgConformance = scoredForFlow.length
    ? round1(scoredForFlow.reduce((sum, a) => sum + a.flowAlignment!.conformanceScore, 0) / scoredForFlow.length)
    : null

  // Criteria met: TRUE share of success criteria met across all per-criterion
  // results (NOT avgScore). null when there are no analyzed criteria (BF-02/P01).
  let criteriaTotal = 0
  let criteriaMet = 0
  for (const a of analyzed) {
    for (const cs of a.scorecard.perCriterion) {
      criteriaTotal += 1
      if (cs.met) criteriaMet += 1
    }
  }
  const criteriaMetRate = criteriaTotal ? round3(criteriaMet / criteriaTotal) : null

  let lastAnalyzedAt: string | undefined
  for (const a of analyzed) {
    if (!lastAnalyzedAt || a.createdAt > lastAnalyzedAt) lastAnalyzedAt = a.createdAt
  }

  return {
    agent,
    callsAnalyzed,
    avgScore: round1(avgScore),
    failureRate: round3(failureRate),
    openUseActions,
    avgConformance,
    criteriaMetRate,
    ...(lastAnalyzedAt ? { lastAnalyzedAt } : {})
  }
}

/**
 * Lookups the recommendation rollup needs to attach a source to each item.
 * Both are optional: a missing agent/call just yields a thinner source (the
 * advice still deep-links by id). `agentsById` resolves the agent name;
 * `callsById` resolves the source call's contact name + start time, and the
 * per-call score comes from each analysis' own scorecard.
 */
export interface RecommendationSources {
  agentsById?: Map<string, Agent>
  callsById?: Map<string, Call>
}

/**
 * Pick the highest-impact, deduped recommendations across a set of analyses,
 * each tagged with the source call/agent that best represents it so the UI can
 * deep-link back (W09). Dedup key is target + normalized title so the same
 * advice surfaced on many calls collapses to one item. For a deduped item the
 * carried source is the strongest contributing call: highest call score's
 * inverse is irrelevant — we pick by recommendation impact, then most recent
 * call. Sorted high impact first, then by how many calls raised it. Capped at
 * `limit` (pass `Infinity` for the full fix-queue).
 */
export function topRecommendations(
  analyses: Analysis[],
  limit = 6,
  sources: RecommendationSources = {}
): RecommendationItem[] {
  interface Bucket {
    rec: Recommendation
    count: number
    findingIds: Set<string>
    /** Distinct agents that raised this advice — drives agentCount/agentNames (P10). */
    agentIds: Set<string>
    /** The analysis whose call best represents this advice (source for deep-link). */
    sourceAnalysis: Analysis
    sourceImpact: Severity
  }
  const byKey = new Map<string, Bucket>()

  for (const analysis of analyses) {
    for (const rec of analysis.recommendations) {
      const key = `${rec.target}::${rec.title.trim().toLowerCase()}`
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
        existing.agentIds.add(analysis.agentId)
        for (const fid of rec.findingIds) existing.findingIds.add(fid)
        // Keep the strongest impact seen for this advice.
        if (SEVERITY_RANK[rec.impact] > SEVERITY_RANK[existing.rec.impact]) {
          existing.rec = { ...existing.rec, impact: rec.impact }
        }
        // Promote the source to the strongest call: higher rec impact wins,
        // ties break to the more recent call so the link points at fresh evidence.
        const better = SEVERITY_RANK[rec.impact] > SEVERITY_RANK[existing.sourceImpact]
          || (SEVERITY_RANK[rec.impact] === SEVERITY_RANK[existing.sourceImpact]
            && analysisCallTime(analysis) > analysisCallTime(existing.sourceAnalysis, sources))
        if (better) {
          existing.sourceAnalysis = analysis
          existing.sourceImpact = rec.impact
        }
      } else {
        byKey.set(key, {
          rec,
          count: 1,
          findingIds: new Set(rec.findingIds),
          agentIds: new Set([analysis.agentId]),
          sourceAnalysis: analysis,
          sourceImpact: rec.impact
        })
      }
    }
  }

  return [...byKey.values()]
    .sort((a, b) => {
      const impactDiff = SEVERITY_RANK[b.rec.impact] - SEVERITY_RANK[a.rec.impact]
      if (impactDiff !== 0) return impactDiff
      return b.count - a.count
    })
    .slice(0, limit)
    .map(({ rec, findingIds, count, agentIds, sourceAnalysis }) =>
      toRecommendationItem(
        { ...rec, findingIds: [...findingIds] },
        sourceAnalysis,
        sources,
        { callCount: count, agentIds }
      )
    )
}

/** Resolve the source call's startedAt for tie-breaking (falls back to analysis.createdAt). */
function analysisCallTime(analysis: Analysis, sources: RecommendationSources = {}): string {
  return sources.callsById?.get(analysis.callId)?.startedAt ?? analysis.createdAt
}

/** Recurrence counts carried from the dedup bucket (P10). */
interface RecommendationRecurrence {
  callCount: number
  agentIds: Set<string>
}

/** Tag one recommendation with the call/agent that raised it for deep-linking. */
function toRecommendationItem(
  recommendation: Recommendation,
  analysis: Analysis,
  sources: RecommendationSources,
  recurrence: RecommendationRecurrence
): RecommendationItem {
  const agent = sources.agentsById?.get(analysis.agentId)
  const call = sources.callsById?.get(analysis.callId)

  // Resolve the distinct agents that raised this advice into display names so the
  // card can show "across N agents" with the actual names (falls back to the id).
  const agentNames = [...recurrence.agentIds].map(
    id => sources.agentsById?.get(id)?.name ?? id
  )

  return {
    recommendation,
    callId: analysis.callId,
    agentId: analysis.agentId,
    agentName: agent?.name ?? analysis.agentId,
    ...(call?.contactName ? { contactName: call.contactName } : {}),
    callScore: analysis.scorecard.overall,
    ...(call?.startedAt ? { callStartedAt: call.startedAt } : {}),
    callCount: recurrence.callCount,
    agentCount: recurrence.agentIds.size,
    ...(agentNames.length ? { agentNames } : {})
  }
}

/**
 * Roll up the whole fleet. `analyses` is every stored analysis; `calls` every
 * stored call. Tolerates empty storage (all metrics fall back to 0 / []).
 */
export function computeFleetStats(
  agents: Agent[],
  calls: Call[],
  analyses: Analysis[]
): FleetStats {
  const analysesByCallId = new Map<string, Analysis>()
  for (const a of analyses) analysesByCallId.set(a.callId, a)

  const callIds = new Set(calls.map(c => c.id))
  const callsByAgent = new Map<string, Call[]>()
  for (const call of calls) {
    const list = callsByAgent.get(call.agentId)
    if (list) list.push(call)
    else callsByAgent.set(call.agentId, [call])
  }

  const agentHealths = agents.map(agent =>
    computeAgentHealth(agent, callsByAgent.get(agent.id) ?? [], analysesByCallId)
  )

  // Source lookups so top recommendations can deep-link to their origin (W09).
  const agentsById = new Map(agents.map(a => [a.id, a]))
  const callsById = new Map(calls.map(c => [c.id, c]))

  // Fleet-level metrics only consider analyses whose call actually exists in
  // storage, so an orphaned analysis (its call was deleted) can't skew the KPIs.
  // This matches the trend chart, which iterates over stored calls.
  const liveAnalyses = analyses.filter(a => callIds.has(a.callId))
  const callsAnalyzed = liveAnalyses.length
  const fleetHealth = callsAnalyzed
    ? liveAnalyses.reduce((sum, a) => sum + a.scorecard.overall, 0) / callsAnalyzed
    : 0
  const failures = liveAnalyses.filter(isFailure).length
  const failureRate = callsAnalyzed ? failures / callsAnalyzed : 0
  const openUseActions = liveAnalyses.reduce((sum, a) => sum + a.useActions.length, 0)

  return {
    fleetHealth: round1(fleetHealth),
    callsAnalyzed,
    failureRate: round3(failureRate),
    openUseActions,
    trend: buildTrend(calls, analysesByCallId),
    agents: agentHealths,
    topRecommendations: topRecommendations(liveAnalyses, 6, { agentsById, callsById })
  }
}

/**
 * Average analyzed score per calendar day (by call.startedAt), ascending by date.
 * Days with no analyzed call are omitted.
 */
function buildTrend(
  calls: Call[],
  analysesByCallId: Map<string, Analysis>
): { date: string, score: number }[] {
  const byDay = new Map<string, { sum: number, n: number }>()

  for (const call of calls) {
    const analysis = analysesByCallId.get(call.id)
    if (!analysis) continue
    const day = dayOf(call.startedAt)
    const bucket = byDay.get(day)
    if (bucket) {
      bucket.sum += analysis.scorecard.overall
      bucket.n += 1
    } else {
      byDay.set(day, { sum: analysis.scorecard.overall, n: 1 })
    }
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, { sum, n }]) => ({ date, score: round1(sum / n) }))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
