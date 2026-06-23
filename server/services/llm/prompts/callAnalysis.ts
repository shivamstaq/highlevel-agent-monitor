/**
 * PromptSpec: callAnalysis — findings + recommendations + use-actions + scorecard
 * for one real call, each cited by `evidenceEntryIdxs` into Transcript.entries.
 *
 * MIGRATED VERBATIM from server/services/eval/analysis.ts: the SYSTEM text, the
 * user-prompt assembly (`buildAnalysisPrompt`/`renderEntry`), the `AnalysisResult`
 * output contract, the `isWellCited` gate (now a guardrail), and the
 * transcript-grounded `deterministicAnalysis` (now the `fallback`) are byte-for-
 * byte copies. This keeps the eval pipeline's behaviour identical until it is
 * rewired onto generateStructured next batch.
 *
 * `role: 'reasoner'` (analysis needs strong reasoning + structured output).
 */
import { z } from 'zod'
import type {
  Agent,
  Transcript,
  TranscriptEntry,
  TurnEntry,
  AnalysisResult,
  SuccessCriterion,
  Finding,
  Recommendation,
  UseAction,
  CriterionScore
} from '#shared/types'
import {
  AgentSchema,
  TranscriptSchema,
  SuccessCriterionSchema,
  AnalysisResultSchema
} from '#shared/types'
import { definePrompt } from './types'

/** Vars contract for the analysis prompt. */
export const CallAnalysisVarsSchema = z.object({
  agent: AgentSchema,
  transcript: TranscriptSchema,
  criteria: z.array(SuccessCriterionSchema)
})
export type CallAnalysisVars = z.infer<typeof CallAnalysisVarsSchema>

const SCHEMA_NAME = 'AnalysisResult'

const SYSTEM = [
  'You are a meticulous QA reviewer for voice AI phone agents.',
  'You receive an agent spec, a weighted success rubric, and a timed transcript',
  'whose entries are indexed [idx]. Score the call against EACH criterion, then',
  'surface findings (deviation | failure | missed_opportunity), concrete',
  'recommendations (target: prompt | flow_node | agent_config | training), and',
  'use-actions (review | coach_agent | update_flow | escalate) for segments needing',
  'human follow-up. EVERY finding MUST cite the transcript entry indices it is based',
  'on via evidenceEntryIdxs. Use-actions cite an [start,end] entryRange. Be honest:',
  'if the call went well, return few/no findings and a high score. Return ONLY the',
  'structured object.'
].join('\n')

function buildAnalysisPrompt(agent: Agent, transcript: Transcript, criteria: SuccessCriterion[]): string {
  const rubric = criteria
    .map(c => `- id=${c.id} [${c.kind}, weight=${c.weight}] ${c.label}: ${c.detector}`)
    .join('\n')
  const lines = transcript.entries.map(renderEntry).join('\n')
  return [
    `AGENT: ${agent.ghl.agentName} @ ${agent.ghl.businessName}`,
    `GOAL PROMPT: ${truncate(agent.ghl.agentPrompt, 600)}`,
    '',
    'SUCCESS CRITERIA:',
    rubric,
    '',
    'TRANSCRIPT (entries indexed [idx]; speaker agent|customer|action):',
    lines
  ].join('\n')
}

function renderEntry(e: TranscriptEntry): string {
  if (e.role === 'action') return `[${e.idx}] action: ${e.toolName} (${e.toolType})`
  return `[${e.idx}] ${e.role}: ${e.content.trim()}`
}

/* -------------------------------------------------------------------------- */
/* Guardrail — every finding must cite ≥1 transcript entry idx.               */
/* -------------------------------------------------------------------------- */

/**
 * A provider result is "well cited" when every finding references at least one
 * transcript entry idx. An empty findings list is fine (a clean call). This is the
 * gate that rejects legacy/degraded LLM output in favour of the grounded fallback.
 */
function wellCitedGuardrail(out: AnalysisResult): void {
  if (out.findings.length === 0) return
  if (!out.findings.every(f => f.evidenceEntryIdxs.length > 0)) {
    throw new Error('callAnalysis: every finding must cite ≥1 transcript entry idx')
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback analysis (transcript-grounded, contract-valid)      */
/* -------------------------------------------------------------------------- */

function deterministicAnalysis(
  agent: Agent,
  transcript: Transcript,
  criteria: SuccessCriterion[]
): AnalysisResult {
  const turns = transcript.entries.filter(isTurn)
  const customer = turns.filter(t => t.role === 'customer')
  const agentTurns = turns.filter(t => t.role === 'agent')

  const findings: Finding[] = []
  const useActions: UseAction[] = []

  // Heuristic 1 — missed opportunity: a buying/scheduling signal not converted.
  for (const c of customer) {
    if (/(interested|schedule|book|when can|call me|how much|sign up|ready)/i.test(c.content)) {
      const next = agentTurns.find(t => t.idx > c.idx)
      if (next && !/(book|schedul|reserve|put you down|appointment|confirm|next step|slot)/i.test(next.content)) {
        findings.push({
          id: 'missed_opportunity_1',
          type: 'missed_opportunity',
          criterionId: pickCriterion(criteria, 'outcome'),
          severity: 'medium',
          title: 'Buying signal not converted to a concrete next step',
          detail:
            'The caller expressed clear intent but the next agent turn did not lock in a specific appointment or follow-up.',
          evidenceEntryIdxs: [c.idx, next.idx]
        })
        useActions.push({
          id: `ua_${c.idx}`,
          callId: transcript.callId,
          reason: 'Caller was ready to commit but was not closed — worth a human follow-up and a script tweak.',
          entryRange: [c.idx, next.idx],
          recommendedAction: 'coach_agent'
        })
        break
      }
    }
  }

  // Heuristic 2 — failure: unresolved frustration / off-goal request mishandled.
  for (const c of customer) {
    if (/(frustrat|angry|ridiculous|not helpful|useless|complaint|terrible|waste|wrong)/i.test(c.content)) {
      findings.push({
        id: 'failure_1',
        type: 'failure',
        criterionId: pickCriterion(criteria, 'tone'),
        severity: 'high',
        title: 'Unresolved caller frustration',
        detail: 'The caller voiced dissatisfaction the agent did not de-escalate or resolve.',
        evidenceEntryIdxs: [c.idx]
      })
      useActions.push({
        id: `ua_esc_${c.idx}`,
        callId: transcript.callId,
        reason: 'Caller frustration went unaddressed — escalate to a human for recovery.',
        entryRange: [c.idx, Math.min(c.idx + 1, lastIdx(transcript))],
        recommendedAction: 'escalate'
      })
      break
    }
  }

  // Heuristic 3 — deviation: caller asked for an off-goal thing (intent confusion).
  for (const c of customer) {
    if (/(interview|different|something else|other than|instead)/i.test(c.content) && findings.length < 3) {
      findings.push({
        id: 'deviation_1',
        type: 'deviation',
        criterionId: pickCriterion(criteria, 'behavior'),
        severity: 'low',
        title: 'Caller intent initially diverged from the agent goal',
        detail:
          'The caller requested something outside the agent’s configured goal; the agent had to redirect, a minor flow deviation worth monitoring.',
        evidenceEntryIdxs: [c.idx]
      })
      break
    }
  }

  // Scorecard — start at 100, deduct per finding by severity; per-criterion derived.
  const penalty: Record<Finding['severity'], number> = { low: 8, medium: 18, high: 30 }
  let overall = 100
  for (const f of findings) overall -= penalty[f.severity]
  overall = clamp(overall, 0, 100)

  const perCriterion: CriterionScore[] = criteria.map((cr) => {
    const hit = findings.find(f => f.criterionId === cr.id)
    const met = !hit
    const score = met ? 92 : clamp(100 - penalty[hit!.severity] * 2, 0, 100)
    return {
      criterionId: cr.id,
      met,
      score,
      evidence: hit
        ? `${hit.title} (entries ${hit.evidenceEntryIdxs.join(', ')}).`
        : 'No violations detected for this criterion in the transcript.'
    }
  })
  // Reconcile the headline with the weighted criteria scores when criteria exist.
  if (criteria.length > 0) {
    const totalW = criteria.reduce((s, c) => s + c.weight, 0) || 1
    const weighted
      = perCriterion.reduce((s, p, i) => s + p.score * (criteria[i]!.weight ?? 0), 0) / totalW
    overall = clamp(Math.round((overall + weighted) / 2), 0, 100)
  }

  const recommendations = buildRecommendations(findings)

  const summary
    = findings.length === 0
      ? `The call met its success criteria with no significant deviations, failures, or missed opportunities. ${endedCleanly(transcript) ? 'It concluded with a clean end-call.' : ''}`.trim()
      : `Detected ${findings.length} issue(s): ${[...new Set(findings.map(f => f.type.replace('_', ' ')))].join(', ')}. See findings and recommendations.`

  return AnalysisResultSchema.parse({
    summary,
    scorecard: { overall, perCriterion },
    findings,
    recommendations,
    useActions
  })
}

function buildRecommendations(findings: Finding[]): Recommendation[] {
  const recs: Recommendation[] = []
  if (findings.some(f => f.type === 'missed_opportunity')) {
    recs.push({
      id: 'rec_close_loop',
      target: 'prompt',
      title: 'Add an explicit close-the-loop step',
      rationale: 'The agent recognized interest but did not propose a concrete time, losing the conversion.',
      suggestedChange:
        'When the caller signals intent, immediately offer two specific slots: "Great — I have Tuesday at 10am or Thursday at 2pm. Which works better?"',
      findingIds: findings.filter(f => f.type === 'missed_opportunity').map(f => f.id),
      impact: 'high'
    })
  }
  if (findings.some(f => f.type === 'failure')) {
    recs.push({
      id: 'rec_deescalate',
      target: 'prompt',
      title: 'Strengthen de-escalation handling',
      rationale: 'The agent did not detect or respond to caller frustration, risking churn.',
      suggestedChange:
        'Add to the prompt: "If the caller expresses frustration, acknowledge it, apologize once, and offer to connect them to a human before continuing."',
      findingIds: findings.filter(f => f.type === 'failure').map(f => f.id),
      impact: 'high'
    })
  }
  if (findings.some(f => f.type === 'deviation')) {
    recs.push({
      id: 'rec_router',
      target: 'flow_node',
      title: 'Add an intent router for off-goal requests',
      rationale: 'Callers asked for things outside the goal; an explicit router would handle redirection cleanly.',
      suggestedChange:
        'Add a Router node after the AI Agent node with an intent like "Caller wants something other than the primary goal → transfer or politely redirect."',
      findingIds: findings.filter(f => f.type === 'deviation').map(f => f.id),
      impact: 'medium'
    })
  }
  if (recs.length === 0) {
    recs.push({
      id: 'rec_maintain',
      target: 'agent_config',
      title: 'Maintain current configuration',
      rationale: 'The call performed well against all criteria; no corrective changes are needed.',
      suggestedChange: 'No change required. Continue monitoring for regressions across future calls.',
      findingIds: [],
      impact: 'low'
    })
  }
  return recs
}

/* -------------------------------------------------------------------------- */
/* Small helpers (verbatim)                                                   */
/* -------------------------------------------------------------------------- */

function pickCriterion(criteria: SuccessCriterion[], kind: SuccessCriterion['kind']): string | undefined {
  return (criteria.find(c => c.kind === kind) ?? criteria[0])?.id
}

function endedCleanly(transcript: Transcript): boolean {
  const last = transcript.entries[transcript.entries.length - 1]
  return !!last && last.role === 'action' && /end_call/i.test(last.toolName)
}

function lastIdx(transcript: Transcript): number {
  return transcript.entries.reduce((m, e) => Math.max(m, e.idx), 0)
}

function isTurn(e: TranscriptEntry): e is TurnEntry {
  return e.role === 'agent' || e.role === 'customer'
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
}

export const callAnalysisPrompt = definePrompt<CallAnalysisVars, AnalysisResult>({
  id: 'callAnalysis',
  version: '1.0.0',
  role: 'reasoner',
  mode: 'tool',
  schemaName: SCHEMA_NAME,
  inputSchema: CallAnalysisVarsSchema,
  outputSchema: AnalysisResultSchema,
  system: () => SYSTEM,
  user: ({ agent, transcript, criteria }) => buildAnalysisPrompt(agent, transcript, criteria),
  guardrails: [wellCitedGuardrail],
  fallback: ({ agent, transcript, criteria }) => deterministicAnalysis(agent, transcript, criteria),
  maxTokens: 16000
})
