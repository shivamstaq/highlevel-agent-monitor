// CREATED (our eval layer)
/**
 * Shared aggregation helpers for the read API (M5 rollup).
 *
 * These functions turn the flat stored entities (Agent / Call / Analysis) into
 * the composite shapes the dashboard consumes (AgentHealth / FleetStats /
 * CallListItem / RecommendationItem). They are pure: given the raw rows they
 * compute the rollups, so they are trivially testable and tolerate calls that
 * have not been analyzed yet (score null, topSeverity null, conformance null).
 *
 * Contract note (redesign §2): the enriched `Agent` wraps the borrowed GHL record
 * (`agent.ghl.id` / `agent.ghl.agentName`), a `Call` is timestamped by
 * `createdAt`, and flow conformance lives on `analysis.conformance` (the
 * deterministic FlowConformance from conformance.ts). All metrics trace to those
 * real fields; nothing is invented.
 */
import type {
  Agent,
  AgentHealth,
  Analysis,
  Call,
  CallListItem,
  FleetStats,
  FlowAlignment,
  Recommendation,
  RecommendationItem,
  Severity
} from '#shared/types'

/**
 * Flow adherence (0–100) for ONE call — the single, honest flow metric (R3).
 *
 * = share of APPLICABLE intended-flow steps the agent handled on-track. Applicable
 * = nodes the call actually reached (status ≠ not_reached); the numerator is the
 * `on_track` count. `drifted`/`skipped` lower it; branches the caller never took
 * (`not_reached`) are excluded so the agent isn't penalised for paths that didn't
 * apply. Null when there's no alignment yet (UI shows "—", never a fabricated 0).
 *
 * This REPLACES the retired deterministic `conformance.conformanceScore`, which
 * only checked graph traversal and clustered near 100, contradicting the drift the
 * UI now shows. Defining it once here keeps the per-call tile and every aggregate
 * in exact agreement.
 */
export function computeFlowAdherence(alignment: FlowAlignment | null | undefined): number | null {
  if (!alignment) return null
  const applicable = alignment.nodeAlignments.filter(n => n.status !== 'not_reached')
  if (applicable.length === 0) return null
  const onTrack = applicable.filter(n => n.status === 'on_track').length
  return Math.round((100 * onTrack) / applicable.length)
}

/* ============================================================================
 * Rollup index (write-time summary) — KV-scale read path.
 *
 * On Cloudflare KV a full fleet read previously scanned every `analyses:<id>`
 * value (N list + N get subrequests, each value carrying the full transcript-
 * derived findings/timeline/stageSet). That blows the 1000-subrequest budget
 * once the call volume grows. To keep the Overview/Agent-list endpoints O(1),
 * `upsertAnalysis` maintains a single compact `index:fleet` record holding ONLY
 * the small fields these rollup functions read — never the heavy analysis body.
 *
 * `AnalysisSummary` is the projection of `Analysis` that the fleet/agent rollups
 * and the trend chart consume. It MUST stay a strict subset of what the full-
 * object code paths below read, so summary-driven metrics match scan-driven
 * metrics exactly (parity is asserted in tests).
 * ========================================================================== */

/** A finding reduced to the only attribute the rollups read: its severity. */
export interface FindingSummary {
  severity: Severity
}

/** Compact per-analysis projection stored in the fleet index. */
export interface AnalysisSummary {
  callId: string
  agentId: string
  createdAt: string
  /** scorecard.overall */
  overall: number
  /** scorecard.perCriterion met flags (true count / total drives criteriaMetRate). */
  criteria: { met: boolean }[]
  /** Just severities — drives isFailure / topSeverity without the finding bodies. */
  findings: FindingSummary[]
  /** useActions.length — the rollups only ever sum the count. */
  useActionCount: number
  /** Flow adherence 0–100 (from flowAlignment), else null. The R3 flow metric. */
  flowAdherence: number | null
  /** Kept whole: small relative to transcripts and needed for the fix-queue dedup. */
  recommendations: Recommendation[]
}

/** The single stored fleet index object (`index:fleet`). */
export interface FleetIndex {
  /** version lets a future shape change invalidate stale indexes and rebuild. */
  version: number
  /** Map of callId -> summary. Re-analysing a call overwrites its entry (no dupes). */
  summaries: Record<string, AnalysisSummary>
}

// NOTE: the summary swapped conformanceScore → flowAdherence, but this is a
// READ-TOLERANT change (the new code only reads flowAdherence, which is simply
// absent on pre-existing entries → null until that call is re-analyzed, plus the
// unchanged overall/criteria/findings). So we deliberately do NOT bump the
// version: an existing index keeps serving scores, and re-analysis backfills
// flowAdherence in place. A bump would discard the index with no rebuild on the
// read path (by design, no getKeys on the hot path), erasing scores in prod.
export const FLEET_INDEX_VERSION = 1

/**
 * The single stored agents index object (`index:agents`). Holds the FULL Agent
 * record (including the flow graph) keyed by agentId — there are only a handful
 * of agents so the whole map stays well under the value-size cap. Maintained on
 * every `upsertAgent` so dashboard reads never scan `agents:<id>` keys.
 */
export interface AgentsIndex {
  version: number
  /** Map of agentId -> Agent. Re-upserting an agent overwrites its entry (no dupes). */
  agents: Record<string, Agent>
}

export const AGENTS_INDEX_VERSION = 1

/**
 * The single stored calls index object (`index:calls`). Holds the small Call
 * record (NO transcript/analysis bodies) keyed by callId. Maintained on every
 * `upsertCall` so the calls table / fleet rollup read ONE object instead of an
 * N-key `calls:<id>` scan.
 */
export interface CallsIndex {
  version: number
  /** Map of callId -> Call. Re-upserting a call overwrites its entry (no dupes). */
  calls: Record<string, Call>
}

export const CALLS_INDEX_VERSION = 1

/** Accept either a full Analysis or an already-projected summary as a summary. */
function asHealthRow(a: Analysis | AnalysisSummary): AnalysisSummary {
  return 'scorecard' in a ? toAnalysisSummary(a) : a
}

/** Project a full Analysis down to the compact summary the index stores. */
export function toAnalysisSummary(a: Analysis): AnalysisSummary {
  return {
    callId: a.callId,
    agentId: a.agentId,
    createdAt: a.createdAt,
    overall: a.scorecard.overall,
    criteria: a.scorecard.perCriterion.map(c => ({ met: c.met })),
    findings: a.findings.map(f => ({ severity: f.severity })),
    useActionCount: a.useActions.length,
    flowAdherence: computeFlowAdherence(a.flowAlignment),
    recommendations: a.recommendations
  }
}

/** A call is a "failure" if it scored below this, or carries a high finding. */
const FAILURE_SCORE_THRESHOLD = 60

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 }

/**
 * Failure / severity predicates operate on the SUMMARY shape (just overall +
 * finding severities), so they run identically against a full Analysis and
 * against an index `AnalysisSummary`. A full Analysis is structurally a superset,
 * so it is accepted directly.
 */
type ScoredSummary = Pick<AnalysisSummary, 'overall' | 'findings'>

function asSummaryScore(a: Analysis | ScoredSummary): ScoredSummary {
  // Analysis nests the score under scorecard; the summary hoists it to `overall`.
  return 'scorecard' in a
    ? { overall: a.scorecard.overall, findings: a.findings.map(f => ({ severity: f.severity })) }
    : a
}

/** Does this carry at least one high-severity finding? */
function hasHighSeverityFailure(a: Analysis | ScoredSummary): boolean {
  return asSummaryScore(a).findings.some(f => f.severity === 'high')
}

/** A call counts as a failure when scored < 60 or it has a high-severity finding. */
function isFailure(a: Analysis | ScoredSummary): boolean {
  const s = asSummaryScore(a)
  return s.overall < FAILURE_SCORE_THRESHOLD || hasHighSeverityFailure(s)
}

/** Highest finding severity, or null when there are no findings. */
function topSeverityOf(a: Analysis | ScoredSummary | null): Severity | null {
  if (!a) return null
  const s = asSummaryScore(a)
  if (s.findings.length === 0) return null
  return s.findings.reduce<Severity>((top, f) => {
    return SEVERITY_RANK[f.severity] > SEVERITY_RANK[top] ? f.severity : top
  }, 'low')
}

/** `YYYY-MM-DD` portion of an ISO timestamp (used to bucket the trend chart). */
function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Flatten one call + its (optional) analysis into the list-item the table renders.
 * agentName is resolved by the caller via the agent map so this stays pure. The
 * flow conformance headline (0–100) is surfaced too — null until the call is
 * analyzed (so the UI shows "—" rather than a fabricated 0).
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
    findingCount: analysis ? analysis.findings.length : 0,
    flowAdherence: computeFlowAdherence(analysis?.flowAlignment)
  }
}

/**
 * Index-fed variant of {@link toCallListItem}: builds the same CallListItem off
 * the compact `AnalysisSummary` (from `index:fleet`) instead of the full Analysis
 * body, so the calls table reads ONLY indexes (no `getAnalysis` per row). The
 * summary carries every field the list item surfaces — `overall` (score),
 * `findings[].severity` (topSeverity + findingCount), and `conformanceScore` — so
 * the output is byte-identical to the scan-based path.
 */
export function toCallListItemFromSummary(
  call: Call,
  agentName: string,
  summary: AnalysisSummary | null
): CallListItem {
  return {
    call,
    agentName,
    score: summary ? summary.overall : null,
    topSeverity: topSeverityOf(summary),
    findingCount: summary ? summary.findings.length : 0,
    flowAdherence: summary ? summary.flowAdherence : null
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
  analysesByCallId: Map<string, Analysis | AnalysisSummary>
): AgentHealth {
  const analyzed: AnalysisSummary[] = []
  for (const call of calls) {
    const a = analysesByCallId.get(call.id)
    if (a) analyzed.push(asHealthRow(a))
  }

  const callsAnalyzed = analyzed.length
  const avgScore = callsAnalyzed
    ? analyzed.reduce((sum, a) => sum + a.overall, 0) / callsAnalyzed
    : 0
  const failures = analyzed.filter(isFailure).length
  const failureRate = callsAnalyzed ? failures / callsAnalyzed : 0
  const openUseActions = analyzed.reduce((sum, a) => sum + a.useActionCount, 0)

  // Flow adherence: mean per-call flow adherence (from flowAlignment) over the
  // calls that carry one. Stays null when none are scored so the UI shows "—"
  // rather than a fabricated 0 (P11).
  const scoredForFlow = analyzed.filter(a => a.flowAdherence != null)
  const avgFlowAdherence = scoredForFlow.length
    ? round1(scoredForFlow.reduce((sum, a) => sum + a.flowAdherence!, 0) / scoredForFlow.length)
    : null

  // Criteria met: TRUE share of success criteria met across all per-criterion
  // results (NOT avgScore). null when there are no analyzed criteria (BF-02/P01).
  let criteriaTotal = 0
  let criteriaMet = 0
  for (const a of analyzed) {
    for (const cs of a.criteria) {
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
    agentId: agent.ghl.id,
    agentName: agent.ghl.agentName,
    callsAnalyzed,
    avgScore: round1(avgScore),
    failureRate: round3(failureRate),
    openUseActions,
    avgFlowAdherence,
    criteriaMetRate,
    ...(lastAnalyzedAt ? { lastAnalyzedAt } : {})
  }
}

/**
 * Lookups the recommendation rollup needs to attach a source to each item.
 * Both are optional: a missing agent/call just yields a thinner source (the
 * advice still deep-links by id). `agentsById` resolves the agent name;
 * `callsById` resolves the source call's start time, and the per-call score
 * comes from each analysis' own scorecard.
 */
export interface RecommendationSources {
  agentsById?: Map<string, Agent>
  callsById?: Map<string, Call>
}

/**
 * Pick the highest-impact, deduped recommendations across a set of analyses,
 * each tagged with the source call/agent that best represents it so the UI can
 * deep-link back (W09).
 *
 * Dedup is SEMANTIC (P10/R3-02), not string-exact: LLM titles for the same
 * systemic fix vary call to call, so we cluster by `target` plus a shared salient
 * keyword (retention, callback, pricing…). Two calls that each raise the same
 * advice collapse into one bucket with callCount > 1 — even across agents when
 * the surface + keyword match — instead of staying distinct because their
 * model-authored titles differ word-for-word.
 *
 * For a deduped item the carried source is the strongest contributing call:
 * highest recommendation impact, then most recent call. Sorted high impact
 * first, then by how many calls raised it. Capped at `limit` (pass `Infinity`
 * for the full fix-queue).
 */
/**
 * The minimal per-call projection `topRecommendations` reads. Both a full
 * `Analysis` and an index `AnalysisSummary` satisfy it (each carries callId /
 * agentId / createdAt / recommendations and exposes the overall score), so the
 * fix-queue is computed identically from the scan and from the index.
 */
export interface RecSource {
  callId: string
  agentId: string
  createdAt: string
  recommendations: Recommendation[]
  /** scorecard.overall — read by toRecommendationItem for the source call score. */
  overall: number
}

/** Normalise an Analysis | AnalysisSummary down to the RecSource projection. */
function toRecSource(a: Analysis | AnalysisSummary): RecSource {
  const overall = 'scorecard' in a ? a.scorecard.overall : a.overall
  return {
    callId: a.callId,
    agentId: a.agentId,
    createdAt: a.createdAt,
    recommendations: a.recommendations,
    overall
  }
}

export function topRecommendations(
  analyses: (Analysis | AnalysisSummary)[],
  limit = 6,
  sources: RecommendationSources = {}
): RecommendationItem[] {
  interface Bucket {
    rec: Recommendation
    count: number
    findingIds: Set<string>
    /** Salient keywords seen across the advice in this cluster (drives merging). */
    keywords: Set<string>
    /** Distinct agents that raised this advice — drives agentCount/agentNames (P10). */
    agentIds: Set<string>
    /** Distinct source calls that raised this advice — the honest callCount (P10). */
    callIds: Set<string>
    /** The source row whose call best represents this advice (for deep-link). */
    sourceAnalysis: RecSource
    sourceImpact: Severity
  }

  const clusters: Bucket[] = []
  for (const row of analyses) {
    const analysis = toRecSource(row)
    for (const rec of analysis.recommendations) {
      const keywords = extractRecKeywords(rec.title)
      const bucket = clusters.find(c => c.rec.target === rec.target && hasKeywordOverlap(c.keywords, keywords))
      if (bucket) {
        bucket.callIds.add(analysis.callId)
        bucket.count = bucket.callIds.size
        bucket.agentIds.add(analysis.agentId)
        for (const fid of rec.findingIds) bucket.findingIds.add(fid)
        for (const k of keywords) bucket.keywords.add(k)
        if (SEVERITY_RANK[rec.impact] > SEVERITY_RANK[bucket.rec.impact]) {
          bucket.rec = { ...bucket.rec, impact: rec.impact }
        }
        // Promote the source to the strongest call: higher rec impact wins, ties
        // break to the more recent call so the link points at fresh evidence.
        const better = SEVERITY_RANK[rec.impact] > SEVERITY_RANK[bucket.sourceImpact]
          || (SEVERITY_RANK[rec.impact] === SEVERITY_RANK[bucket.sourceImpact]
            && analysisCallTime(analysis, sources) > analysisCallTime(bucket.sourceAnalysis, sources))
        if (better) {
          bucket.sourceAnalysis = analysis
          bucket.sourceImpact = rec.impact
        }
      } else {
        clusters.push({
          rec,
          count: 1,
          findingIds: new Set(rec.findingIds),
          keywords,
          agentIds: new Set([analysis.agentId]),
          callIds: new Set([analysis.callId]),
          sourceAnalysis: analysis,
          sourceImpact: rec.impact
        })
      }
    }
  }

  return clusters
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

/** Resolve the source call's createdAt for tie-breaking (falls back to row.createdAt). */
function analysisCallTime(analysis: RecSource, sources: RecommendationSources = {}): string {
  return sources.callsById?.get(analysis.callId)?.createdAt ?? analysis.createdAt
}

/**
 * Generic words that carry no topic — stripped so only domain terms (retention,
 * callback, pricing, empathy, insurance…) drive recommendation clustering (R3-02).
 */
const REC_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'their', 'its', 'before', 'after', 'when', 'into', 'from',
  'ensure', 'include', 'improve', 'update', 'train', 'agent', 'agents', 'script', 'prompt', 'call', 'calls',
  'step', 'steps', 'handle', 'handling', 'customer', 'customers', 'information', 'proper', 'specific', 'provide',
  'implement', 'confirm', 'confirmation', 'detail', 'details', 'collection', 'phrasing', 'explicit', 'reminder',
  'check', 'enhance', 'scenario', 'scenarios', 'issue', 'issues', 'address', 'about', 'should', 'make', 'adding',
  'back', 'read', 'number', 'first', 'them', 'they', 'while', 'proceeding', 'node', 'flow', 'add', 'strengthen'
])

/** Salient (≥4-char, non-stopword) keywords from a recommendation title. */
function extractRecKeywords(title: string): Set<string> {
  return new Set(
    title.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !REC_STOPWORDS.has(w))
  )
}

function hasKeywordOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const w of b) if (a.has(w)) return true
  return false
}

/** Recurrence counts carried from the dedup bucket (P10). */
interface RecommendationRecurrence {
  callCount: number
  agentIds: Set<string>
}

/** Tag one recommendation with the call/agent that raised it for deep-linking. */
function toRecommendationItem(
  recommendation: Recommendation,
  analysis: RecSource,
  sources: RecommendationSources,
  recurrence: RecommendationRecurrence
): RecommendationItem {
  const agent = sources.agentsById?.get(analysis.agentId)
  const call = sources.callsById?.get(analysis.callId)

  // Resolve the distinct agents that raised this advice into display names so the
  // card can show "across N agents" with the actual names (falls back to the id).
  const agentNames = [...recurrence.agentIds].map(
    id => sources.agentsById?.get(id)?.ghl.agentName ?? id
  )

  return {
    recommendation,
    callId: analysis.callId,
    agentId: analysis.agentId,
    agentName: agent?.ghl.agentName ?? analysis.agentId,
    callScore: analysis.overall,
    ...(call?.createdAt ? { callCreatedAt: call.createdAt } : {}),
    callCount: recurrence.callCount,
    agentCount: recurrence.agentIds.size,
    ...(agentNames.length ? { agentNames } : {})
  }
}

/**
 * Roll up the whole fleet. `analyses` is every stored analysis; `calls` every
 * stored call. Tolerates empty storage (all metrics fall back to 0 / []).
 *
 * This is the full-object (scan) path used by the per-call detail screens and as
 * the parity reference. The Overview/Agent-list endpoints should prefer
 * {@link computeFleetStatsFromIndex}, which reads the same metrics off the compact
 * `index:fleet` record (O(1) KV reads) instead of every analysis body.
 */
export function computeFleetStats(
  agents: Agent[],
  calls: Call[],
  analyses: Analysis[]
): FleetStats {
  return computeFleetStatsFromSummaries(agents, calls, analyses.map(toAnalysisSummary))
}

/**
 * The O(1)-read entry point for the dashboard: roll up the fleet from the compact
 * write-time index rather than scanning every analysis. `index.summaries` is the
 * map maintained by `upsertAnalysis` in db.ts. Metrics are byte-for-byte identical
 * to {@link computeFleetStats} because both funnel through
 * {@link computeFleetStatsFromSummaries} and the summary is a strict projection.
 */
export function computeFleetStatsFromIndex(
  agents: Agent[],
  calls: Call[],
  index: FleetIndex
): FleetStats {
  return computeFleetStatsFromSummaries(agents, calls, Object.values(index.summaries))
}

/**
 * The pure all-from-indexes entry point used by GET /api/agents: unpack the three
 * write-time index maps (`index:agents`, `index:calls`, `index:fleet`) and roll up
 * the fleet. Identical metrics to {@link computeFleetStats}/{@link computeFleetStatsFromIndex}
 * — all three funnel through {@link computeFleetStatsFromSummaries}. With every
 * index empty this yields the zeroed FleetStats (no throw), so the endpoint never
 * 500s on a fresh KV.
 */
export function computeFleetStatsFromIndexes(
  agentsIndex: AgentsIndex,
  callsIndex: CallsIndex,
  fleetIndex: FleetIndex
): FleetStats {
  return computeFleetStatsFromSummaries(
    Object.values(agentsIndex.agents),
    Object.values(callsIndex.calls),
    Object.values(fleetIndex.summaries)
  )
}

/** Shared core: fleet rollup over the compact summary shape. */
function computeFleetStatsFromSummaries(
  agents: Agent[],
  calls: Call[],
  summaries: AnalysisSummary[]
): FleetStats {
  const summaryByCallId = new Map<string, AnalysisSummary>()
  for (const a of summaries) summaryByCallId.set(a.callId, a)

  const callIds = new Set(calls.map(c => c.id))
  const callsByAgent = new Map<string, Call[]>()
  for (const call of calls) {
    const list = callsByAgent.get(call.agentId)
    if (list) list.push(call)
    else callsByAgent.set(call.agentId, [call])
  }

  const agentHealths = agents.map(agent =>
    computeAgentHealth(agent, callsByAgent.get(agent.ghl.id) ?? [], summaryByCallId)
  )

  // Source lookups so top recommendations can deep-link to their origin (W09).
  const agentsById = new Map(agents.map(a => [a.ghl.id, a]))
  const callsById = new Map(calls.map(c => [c.id, c]))

  // Fleet-level metrics only consider analyses whose call actually exists in
  // storage, so an orphaned analysis (its call was deleted) can't skew the KPIs.
  // This matches the trend chart, which iterates over stored calls.
  const liveAnalyses = summaries.filter(a => callIds.has(a.callId))
  const callsAnalyzed = liveAnalyses.length
  const fleetHealth = callsAnalyzed
    ? liveAnalyses.reduce((sum, a) => sum + a.overall, 0) / callsAnalyzed
    : 0
  const failures = liveAnalyses.filter(isFailure).length
  const failureRate = callsAnalyzed ? failures / callsAnalyzed : 0
  const openUseActions = liveAnalyses.reduce((sum, a) => sum + a.useActionCount, 0)

  return {
    fleetHealth: round1(fleetHealth),
    callsAnalyzed,
    failureRate: round3(failureRate),
    openUseActions,
    trend: buildTrend(calls, summaryByCallId),
    agents: agentHealths,
    topRecommendations: topRecommendations(liveAnalyses, 6, { agentsById, callsById })
  }
}

/**
 * Average analyzed score per calendar day (by call.createdAt), ascending by date.
 * Days with no analyzed call are omitted.
 */
function buildTrend(
  calls: Call[],
  summaryByCallId: Map<string, AnalysisSummary>
): { date: string, score: number }[] {
  const byDay = new Map<string, { sum: number, n: number }>()

  for (const call of calls) {
    const analysis = summaryByCallId.get(call.id)
    if (!analysis) continue
    const day = dayOf(call.createdAt)
    const bucket = byDay.get(day)
    if (bucket) {
      bucket.sum += analysis.overall
      bucket.n += 1
    } else {
      byDay.set(day, { sum: analysis.overall, n: 1 })
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
