// CREATED (our eval layer)
/**
 * analyzeCall — the M3 orchestrator (redesign §4). Ties the CREATED eval layers
 * together for one real call and persists the result:
 *
 *   1. ensure success criteria (criteria.ts) on the agent.
 *   2. build the three DAGs: borrowed Call-Flow → ExpectedFlow (normative +
 *      per-call, expectedFlow.ts) → ActualFlow (actualFlow.ts).
 *   3. deterministic FlowConformance (conformance.ts) — no LLM.
 *   4. CallTimeline (timeline.ts) — REAL latency + MODELED sub-stages.
 *   5. LLM findings / recommendations / use-actions / scorecard, each cited by
 *      `evidenceEntryIdxs` into Transcript.entries.
 *   6. persist Analysis + ExpectedFlow + CallTimeline via db.ts. Idempotent: a
 *      stable `transcriptHash` short-circuits re-analysis when nothing changed.
 *
 * Provider-agnostic via `server/services/llm`. The deterministic MockProvider (or
 * any provider that can't satisfy the new AnalysisResult contract) is handled by a
 * transcript-grounded fallback so the pipeline always yields contract-valid,
 * deterministic output with zero external dependencies.
 */
import { createHash } from 'node:crypto'
import type {
  Agent,
  Transcript,
  Analysis,
  AnalysisResult,
  AgentStageSet,
  ExpectedFlow,
  CallTimeline,
  FlowConformance,
  SuccessCriterion,
  Finding,
  Recommendation,
  UseAction,
  CriterionScore
} from '#shared/types'
import {
  AnalysisResultSchema,
  AnalysisSchema,
  ExpectedFlowSchema
} from '#shared/types'
import type { FlowAlignment } from '#shared/types'
import { generateStructured, type GenerateMeta } from '../llm/generateStructured'
import { deriveSuccessCriteria } from './criteria'
import { inferAgentStages } from './stages'
import { labelTurns, applyLabels } from './labeling'
import { buildNormative, buildPerCall } from './expectedFlow'
import { buildActualFlow } from './actualFlow'
import { computeConformance } from './conformance'
import { buildTimeline } from './timeline'
import { getOrDeriveInferredFlow } from './inferredFlow'
import { runFlowAlignment } from './flowAlignment'
import type { ProgressFn } from './analysisStatus'
import {
  upsertAnalysis,
  getAnalysis,
  upsertExpectedFlow,
  upsertTimeline,
  upsertTranscript,
  upsertAgent
} from '../db'

export interface AnalyzeOptions {
  /** Re-run even when the transcriptHash matches a stored analysis. */
  force?: boolean
  /** Optional step-by-step progress sink (drives the reactive progress UI). */
  onProgress?: ProgressFn
}

/** No-op progress sink for callers that don't track step-by-step state. */
const NOOP_PROGRESS: ProgressFn = () => {}

export interface AnalyzeOutput {
  analysis: Analysis
  expectedFlow: ExpectedFlow
  timeline: CallTimeline
  conformance: FlowConformance
  /** True when a prior identical analysis was reused (idempotency hit). */
  reused: boolean
}

export async function analyzeCall(
  agent: Agent,
  transcript: Transcript,
  opts: AnalyzeOptions = {}
): Promise<AnalyzeOutput> {
  const callId = transcript.callId
  const transcriptHash = hashTranscript(agent, transcript)
  const progress = opts.onProgress ?? NOOP_PROGRESS

  // ── idempotency: reuse a stored analysis with the same hash ──
  if (!opts.force) {
    const existing = await getAnalysis(callId)
    if (existing && existing.transcriptHash === transcriptHash) {
      const expectedFlow = ExpectedFlowSchema.parse({
        agentId: agent.ghl.id,
        normative: buildNormative(agent),
        perCall: { callId, ideal: buildPerCall(agent, transcript) }
      })
      const timeline = existing.timeline ?? buildTimeline(transcript)
      const conformance
        = existing.conformance
          ?? computeConformance({
            callId,
            expected: expectedFlow,
            // Reuse the persisted stage vocabulary so the rebuilt trace stays
            // multi-node and consistent with the stored analysis.
            actual: buildActualFlow(transcript, agent.flow, existing.stageSet),
            transcript
          })
      return { analysis: existing, expectedFlow, timeline, conformance, reused: true }
    }
  }

  // ── 1. success criteria (derive + persist back onto the agent if absent) ──
  let criteria: SuccessCriterion[] = agent.successCriteria
  if (criteria.length === 0) {
    await progress('criteria', 'active')
    criteria = await deriveSuccessCriteria(agent)
    await progress('criteria', 'done', `${criteria.length} criteria`)
    try {
      await upsertAgent({ ...agent, successCriteria: criteria })
    } catch (err) {
      // Persisting enrichment is best-effort; analysis proceeds regardless — but
      // the failure must be auditable, never silently swallowed.
      console.error(
        `[analyzeCall] failed to persist derived criteria for agent ${agent.ghl.id}:`,
        err instanceof Error ? err.message : err
      )
    }
  } else {
    await progress('criteria', 'skipped', `${criteria.length} criteria (cached)`)
  }

  // The agent used for inference/analysis carries the resolved criteria so the
  // stage-inference grounding (criteria labels) and the analysis prompt see them.
  const enrichedAgent: Agent = { ...agent, successCriteria: criteria }

  // ── 2. dynamic stage vocabulary + batched turn labeling (best-effort) ──
  // Infer THIS agent's conversational stages (cached by spec hash), then label
  // every spoken turn with its stage in ONE batched call. Any failure degrades to
  // an un-labeled transcript — the actual flow still renders a valid core trace.
  let stageSet: AgentStageSet | undefined
  let labeledTranscript: Transcript
  let labelMeta: GenerateMeta | undefined
  // True when stage inference / labeling DEGRADED (threw, or served deterministic
  // fallback) — so a call labeled by the deterministic spine is never presented as
  // fully Claude-driven. Feeds the persisted `usedFallback` flag below.
  let stageLabelingDegraded = false
  try {
    await progress('checkpoints', 'active')
    const inferred = await inferAgentStages(enrichedAgent)
    stageSet = inferred.stageSet
    await progress('checkpoints', 'done', `${stageSet.stages.length} checkpoints`)
    // Stage inference falling back to its deterministic spine is itself a degrade
    // (the multi-node vocabulary is then heuristic, not LLM-inferred).
    if (inferred.meta?.usedFallback) stageLabelingDegraded = true
    await progress('labeling', 'active')
    const labelResult = await labelTurns(stageSet, transcript)
    labelMeta = labelResult.meta
    if (labelMeta?.usedFallback) stageLabelingDegraded = true
    labeledTranscript = applyLabels(transcript, labelResult.labels)
    await progress('labeling', 'done')
  } catch (err) {
    // Stage inference / labeling are enrichment; never BLOCK analysis on them — but
    // a real failure must be auditable (loud log) AND must mark the analysis as
    // degraded so the UI never claims fully-Claude stage labeling (honesty).
    console.error(
      `[analyzeCall] stage inference / turn labeling failed for call ${callId}; ` +
      'degrading to an un-labeled (single-core) actual trace:',
      err instanceof Error ? err.message : err
    )
    stageSet = undefined
    labeledTranscript = transcript
    stageLabelingDegraded = true
  }

  // ── 3. the three DAGs (actual built from the LABELED, multi-node trace) ──
  await progress('conformance', 'active')
  const expectedFlow = ExpectedFlowSchema.parse({
    agentId: agent.ghl.id,
    normative: buildNormative(agent),
    perCall: { callId, ideal: buildPerCall(agent, transcript) }
  })
  const actualFlow = buildActualFlow(labeledTranscript, agent.flow, stageSet)

  // ── 4. conformance (deterministic) — fed the REAL multi-node actual flow ──
  const conformance = computeConformance({
    callId,
    expected: expectedFlow,
    actual: actualFlow,
    transcript: labeledTranscript
  })
  await progress('conformance', 'done', `${Math.round(conformance.conformanceScore)}% conformance`)

  // ── 5. timeline (REAL latency + MODELED sub-stages) ──
  const timeline = buildTimeline(transcript)

  // ── 6 + 7 run IN PARALLEL (independent LLM legs over the labeled transcript) ──
  // The flow-drift leg (derive inferred flow → judge alignment) and the call
  // scoring/findings leg don't depend on each other. Cloudflare caps a request at
  // ~100s, and these are the two heaviest legs, so we OVERLAP them rather than sum
  // their latencies — the difference between fitting under the limit and a 524.
  await progress('drift', 'active')
  await progress('scoring', 'active')
  const [flowLeg, scoringLeg] = await Promise.all([
    (async () => {
      const inferredFlow = await getOrDeriveInferredFlow(enrichedAgent)
      return runFlowAlignment(enrichedAgent, inferredFlow, labeledTranscript)
    })(),
    runAnalysis(enrichedAgent, labeledTranscript, criteria)
  ])
  const { alignment: flowAlignment, meta: driftMeta } = flowLeg
  const { result, meta: analysisMeta } = scoringLeg
  await progress('drift', 'done', driftSummary(flowAlignment))
  await progress('scoring', 'done', `score ${Math.round(result.scorecard.overall)}`)

  // Stamp ids + callId onto LLM-emitted items the schema allows to be terse.
  const normalized = normalizeResult(result, callId, criteria, labeledTranscript)

  // ── 8. assemble + persist (provenance: provider/model/usedFallback + stageSet) ──
  // usedFallback is true when ANY dynamic step served deterministic-fallback output
  // in place of a real provider call — the callAnalysis, the turn labeling, OR the
  // stage inference (which `stageLabelingDegraded` also captures when the labeling
  // step threw outright). This guarantees the UI can never present a call whose
  // multi-node trace came from the deterministic spine as fully Claude-driven
  // (honesty requirement).
  const usedFallback
    = analysisMeta.usedFallback
      || driftMeta.usedFallback
      || (labelMeta?.usedFallback ?? false)
      || stageLabelingDegraded
  const analysis: Analysis = AnalysisSchema.parse({
    ...normalized,
    id: `an_${callId}`,
    callId,
    agentId: agent.ghl.id,
    conformance,
    flowAlignment,
    timeline,
    ...(stageSet ? { stageSet } : {}),
    provider: analysisMeta.provider,
    model: analysisMeta.model,
    usedFallback,
    transcriptHash,
    createdAt: new Date().toISOString()
  })

  await Promise.all([
    upsertAnalysis(analysis),
    upsertExpectedFlow(expectedFlow),
    upsertTimeline(timeline),
    // Persist the LABELED transcript (stageId/evidence are optional, back-compat
    // fields) so the read path can rebuild the same multi-node trace with no LLM.
    labeledTranscript !== transcript
      ? upsertTranscript(labeledTranscript)
      : Promise.resolve()
  ])

  return { analysis, expectedFlow, timeline, conformance, reused: false }
}

/* -------------------------------------------------------------------------- */
/* LLM invocation via the dynamic-LLM seam                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run the call analysis through `generateStructured('callAnalysis', …)`. The seam
 * owns model selection (reasoner → Sonnet, cost-low), the well-cited guardrail and
 * the transcript-grounded deterministic fallback (migrated verbatim into the prompt
 * spec), returning provenance (`provider`/`model`/`usedFallback`) we persist.
 *
 * Best-effort: if the seam itself throws (it shouldn't — it always falls back), we
 * surface a minimal grounded result so ingestion never crashes.
 */
async function runAnalysis(
  agent: Agent,
  transcript: Transcript,
  criteria: SuccessCriterion[]
): Promise<{ result: AnalysisResult, meta: GenerateMeta }> {
  try {
    const { data, meta } = await generateStructured('callAnalysis', { agent, transcript, criteria })
    return { result: data, meta }
  } catch {
    return {
      result: AnalysisResultSchema.parse({
        summary: 'Analysis could not be generated for this call.',
        scorecard: {
          overall: 0,
          perCriterion: criteria.map(c => ({
            criterionId: c.id,
            met: false,
            score: 0,
            evidence: 'Analysis unavailable.'
          }))
        },
        findings: [],
        recommendations: [],
        useActions: []
      }),
      meta: {
        provider: 'none',
        model: 'none',
        promptId: 'callAnalysis',
        promptVersion: '0',
        usedFallback: true
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Result normalization (stamp ids / callId, clamp idxs)                      */
/* -------------------------------------------------------------------------- */

function normalizeResult(
  r: AnalysisResult,
  callId: string,
  criteria: SuccessCriterion[],
  transcript: Transcript
): AnalysisResult {
  const maxIdx = lastIdx(transcript)
  const criterionIds = new Set(criteria.map(c => c.id))
  const clampIdx = (i: number): number => clamp(Math.round(i), 0, Math.max(0, maxIdx))

  const findings: Finding[] = r.findings.map((f, i) => ({
    ...f,
    id: f.id || `finding_${i + 1}`,
    criterionId: f.criterionId && criterionIds.has(f.criterionId) ? f.criterionId : undefined,
    evidenceEntryIdxs: [...new Set(f.evidenceEntryIdxs.map(clampIdx))].sort((a, b) => a - b)
  }))

  const useActions: UseAction[] = r.useActions.map((u, i) => {
    const [s, e] = u.entryRange
    const lo = clampIdx(Math.min(s, e))
    const hi = clampIdx(Math.max(s, e))
    return { ...u, id: u.id || `ua_${i + 1}`, callId, entryRange: [lo, hi] }
  })

  const recommendations: Recommendation[] = r.recommendations.map((rec, i) => ({
    ...rec,
    id: rec.id || `rec_${i + 1}`
  }))

  // Ensure the scorecard references our real criteria ids.
  const perCriterion: CriterionScore[]
    = r.scorecard.perCriterion.length > 0
      ? r.scorecard.perCriterion
      : criteria.map(c => ({ criterionId: c.id, met: true, score: r.scorecard.overall, evidence: 'No per-criterion detail provided by the model.' }))

  return AnalysisResultSchema.parse({
    summary: r.summary,
    scorecard: { overall: clamp(Math.round(r.scorecard.overall), 0, 100), perCriterion },
    findings,
    recommendations,
    useActions
  })
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** One-line drift summary for the progress step detail. */
function driftSummary(alignment: FlowAlignment): string {
  const n = alignment.nodeAlignments.length
  if (n === 0) return 'no flow'
  const onTrack = alignment.nodeAlignments.filter(a => a.status === 'on_track').length
  const tangents = alignment.tangents.length
  return `${onTrack}/${n} on track${tangents ? `, ${tangents} tangent${tangents === 1 ? '' : 's'}` : ''}`
}

function hashTranscript(agent: Agent, transcript: Transcript): string {
  const basis = JSON.stringify({
    a: agent.ghl.id,
    p: agent.ghl.agentPrompt,
    c: agent.successCriteria.map(c => c.id + c.detector),
    e: transcript.entries
  })
  return createHash('sha256').update(basis).digest('hex').slice(0, 32)
}

function lastIdx(transcript: Transcript): number {
  return transcript.entries.reduce((m, e) => Math.max(m, e.idx), 0)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
}
