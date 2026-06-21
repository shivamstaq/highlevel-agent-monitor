import type { AnalysisResult, ExpectedFlowResult, Finding, FlowNodeKind, Recommendation, StageLabel, SuccessCriterion, UseAction } from '#shared/types'
import type { LLMCompleteOptions, LLMProvider } from './types'

/**
 * Deterministic mock provider.
 *
 * Derives a plausible result from the prompt using simple, transcript-grounded
 * heuristics so the app builds, demos, and end-to-end smoke-tests run with zero
 * external dependencies. It serves two schemas, discriminated by `schemaName`:
 *
 *   - 'SuccessCriteria'  -> { criteria: SuccessCriterion[] }   (criteria.ts)
 *   - 'AnalysisResult'   -> AnalysisResult                     (analysis.ts)
 *
 * Both outputs satisfy their respective zod schemas.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock'
  readonly model = 'deterministic'

  async complete(opts: LLMCompleteOptions): Promise<unknown> {
    if (opts.schemaName === 'SuccessCriteria') {
      return { criteria: deriveCriteria(opts.user) }
    }
    if (opts.schemaName === 'ExpectedFlow') {
      return deriveFlow()
    }
    return deriveAnalysis(opts.user)
  }
}

/* -------------------------------------------------------------------------- */
/* Expected-flow derivation                                                   */
/* -------------------------------------------------------------------------- */

/** A deterministic canonical call flow so the zero-dependency demo renders a graph. */
function deriveFlow(): ExpectedFlowResult {
  const spine: { id: string, label: string, kind: FlowNodeKind, expected: boolean, branchConditions: string[] }[] = [
    { id: 'greeting', label: 'Greet & identify', kind: 'greeting', expected: true, branchConditions: [] },
    { id: 'intent', label: 'Establish intent', kind: 'intent', expected: true, branchConditions: [] },
    { id: 'qualify', label: 'Qualify the caller', kind: 'qualify', expected: true, branchConditions: [] },
    { id: 'collect', label: 'Collect required details', kind: 'collect', expected: true, branchConditions: [] },
    { id: 'objection', label: 'Handle objection', kind: 'objection', expected: false, branchConditions: ['caller raises a concern or hesitation'] },
    { id: 'confirm', label: 'Confirm & read back', kind: 'confirm', expected: true, branchConditions: [] },
    { id: 'action', label: 'Execute the goal action', kind: 'action', expected: true, branchConditions: [] },
    { id: 'close', label: 'Close the call', kind: 'close', expected: true, branchConditions: [] }
  ]
  const edges = [
    { from: 'greeting', to: 'intent' },
    { from: 'intent', to: 'qualify' },
    { from: 'qualify', to: 'collect' },
    { from: 'qualify', to: 'objection', condition: 'caller objects' },
    { from: 'objection', to: 'collect' },
    { from: 'collect', to: 'confirm' },
    { from: 'confirm', to: 'action' },
    { from: 'action', to: 'close' }
  ]
  return { nodes: spine, edges }
}

/* -------------------------------------------------------------------------- */
/* Criteria derivation                                                        */
/* -------------------------------------------------------------------------- */

function deriveCriteria(prompt: string): SuccessCriterion[] {
  const lower = prompt.toLowerCase()
  const criteria: SuccessCriterion[] = [
    {
      id: 'goal_outcome',
      label: 'Achieves stated goal',
      kind: 'outcome',
      weight: 0.4,
      detector: 'The agent drives the call toward its primary goal and secures the intended outcome (booking, qualification, or resolution).'
    },
    {
      id: 'follows_script',
      label: 'Follows the script',
      kind: 'behavior',
      weight: 0.25,
      detector: 'The agent covers the required script steps in order without skipping mandatory questions.'
    },
    {
      id: 'professional_tone',
      label: 'Professional, empathetic tone',
      kind: 'tone',
      weight: 0.2,
      detector: 'The agent stays courteous, acknowledges the customer, and avoids robotic or dismissive phrasing.'
    }
  ]

  // Add a compliance criterion when the script/goal hints at it.
  if (/(consent|record|disclos|complian|hipaa|gdpr|verify identity)/.test(lower)) {
    criteria.push({
      id: 'compliance_disclosure',
      label: 'Required disclosures & consent',
      kind: 'compliance',
      weight: 0.15,
      detector: 'The agent gives required disclosures (recording notice, consent, identity verification) before collecting sensitive information.'
    })
  } else {
    criteria.push({
      id: 'capture_next_step',
      label: 'Captures a concrete next step',
      kind: 'outcome',
      weight: 0.15,
      detector: 'The agent confirms a specific, scheduled next step (callback time, appointment, or follow-up) before ending the call.'
    })
  }

  return normalizeWeights(criteria)
}

function normalizeWeights(criteria: SuccessCriterion[]): SuccessCriterion[] {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0)
  if (total === 0) return criteria
  return criteria.map(c => ({ ...c, weight: Math.round((c.weight / total) * 100) / 100 }))
}

/* -------------------------------------------------------------------------- */
/* Analysis derivation                                                        */
/* -------------------------------------------------------------------------- */

interface ParsedTurn {
  idx: number
  speaker: string
  text: string
}

function deriveAnalysis(prompt: string): AnalysisResult {
  const criterionIds = extractCriterionIds(prompt)
  const turns = parseTurns(prompt)

  const findings: Finding[] = []
  const useActions: UseAction[] = []

  const agentTurns = turns.filter(t => t.speaker === 'agent')
  const customerTurns = turns.filter(t => t.speaker === 'customer')

  // Heuristic 1: missed-opportunity — customer raises a buying/scheduling signal
  // and the very next agent turn doesn't pick it up with a concrete next step.
  for (const c of customerTurns) {
    if (/(interested|schedule|book|when can|call me|how much|sign up|ready)/i.test(c.text)) {
      const next = turns.find(t => t.idx === c.idx + 1 && t.speaker === 'agent')
      if (next && !/(book|schedul|let'?s set|i'?ll put you down|calendar|appointment|next step)/i.test(next.text)) {
        findings.push({
          id: 'mock_missed_opportunity',
          type: 'missed_opportunity',
          criterionId: criterionIds[0],
          severity: 'medium',
          title: 'Buying signal not converted to a next step',
          detail: 'The customer expressed clear interest but the agent failed to lock in a concrete appointment or follow-up.',
          evidenceTurnIdxs: [c.idx, next.idx]
        })
        useActions.push({
          id: '',
          callId: 'PENDING',
          reason: 'Customer was ready to commit but the agent did not close. Worth a human follow-up and a script tweak.',
          turnRange: [c.idx, next.idx],
          recommendedAction: 'coach_agent'
        })
        break
      }
    }
  }

  // Heuristic 2: failure — customer voices frustration / unresolved problem.
  for (const c of customerTurns) {
    if (/(frustrat|angry|ridiculous|not helpful|useless|cancel|complaint|terrible|waste)/i.test(c.text)) {
      findings.push({
        id: 'mock_failure',
        type: 'failure',
        criterionId: criterionIds[criterionIds.length - 1],
        severity: 'high',
        title: 'Unresolved customer frustration',
        detail: 'The customer expressed dissatisfaction that the agent did not de-escalate or resolve, putting the relationship at risk.',
        evidenceTurnIdxs: [c.idx]
      })
      useActions.push({
        id: '',
        callId: 'PENDING',
        reason: 'Customer frustration went unaddressed — escalate to a human for recovery.',
        turnRange: [c.idx, Math.min(c.idx + 1, turns.length - 1 >= 0 ? turns.length - 1 : c.idx)],
        recommendedAction: 'escalate'
      })
      break
    }
  }

  // Heuristic 3: deviation — very short agent turns suggest the script was
  // skipped / rushed (a behavior deviation).
  const terseAgentTurn = agentTurns.find(t => t.text.trim().split(/\s+/).length <= 3)
  if (terseAgentTurn && findings.length < 3) {
    findings.push({
      id: 'mock_deviation',
      type: 'deviation',
      criterionId: criterionIds[1] ?? criterionIds[0],
      severity: 'low',
      title: 'Script step rushed or skipped',
      detail: 'An agent turn was unusually terse, indicating a scripted step (qualification or disclosure) may have been skipped.',
      evidenceTurnIdxs: [terseAgentTurn.idx]
    })
  }

  // Score: start from 100 and deduct per finding by severity.
  const penalty: Record<string, number> = { low: 8, medium: 18, high: 30 }
  let overall = 100
  for (const f of findings) overall -= penalty[f.severity] ?? 10
  overall = Math.max(0, Math.min(100, overall))

  const perCriterion = criterionIds.map((cid) => {
    const hit = findings.find(f => f.criterionId === cid)
    const met = !hit
    const score = met ? 90 : Math.max(0, 100 - (penalty[hit!.severity] ?? 10) * 2)
    return {
      criterionId: cid,
      met,
      score,
      evidence: hit
        ? `Issue detected: ${hit.title} (turns ${hit.evidenceTurnIdxs.join(', ')}).`
        : 'No violations detected for this criterion in the transcript.'
    }
  })

  const recommendations: Recommendation[] = buildRecommendations(findings)

  const summary = findings.length === 0
    ? 'The call met its success criteria with no significant deviations, failures, or missed opportunities detected.'
    : `Detected ${findings.length} issue(s): ${findings.map(f => f.type.replace('_', ' ')).join(', ')}. See findings and recommendations for remediation.`

  return {
    summary,
    scorecard: { overall, perCriterion },
    findings,
    recommendations,
    useActions,
    stageLabels: deriveStageLabels(prompt, agentTurns)
  }
}

/**
 * Map each agent turn to an expected-flow node, in declaration order. With fewer
 * agent turns than nodes, trailing nodes go unlabeled -> the conformance engine
 * reports them as skipped (realistic drift signal for the deterministic demo).
 */
function deriveStageLabels(prompt: string, agentTurns: ParsedTurn[]): StageLabel[] {
  const nodes = extractFlowNodes(prompt)
  if (nodes.length === 0) return []
  return agentTurns.map((t, i) => {
    const node = nodes[Math.min(i, nodes.length - 1)]!
    return { turnIdx: t.idx, nodeId: node.id, kind: node.kind }
  })
}

/** Pull "nodeId=<id> [<kind>...]" lines from the expected-flow block of the prompt. */
function extractFlowNodes(prompt: string): { id: string, kind: FlowNodeKind }[] {
  const out: { id: string, kind: FlowNodeKind }[] = []
  const re = /\bnodeId=([a-zA-Z0-9_-]+)\s+\[([a-z_]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(prompt)) !== null) {
    if (m[1] && m[2]) out.push({ id: m[1], kind: m[2] as FlowNodeKind })
  }
  return out
}

function buildRecommendations(findings: Finding[]): Recommendation[] {
  const recs: Recommendation[] = []

  if (findings.some(f => f.type === 'missed_opportunity')) {
    recs.push({
      id: '',
      target: 'script',
      title: 'Add an explicit close-the-loop step',
      rationale: 'The agent recognized interest but never proposed a concrete time, losing a conversion.',
      suggestedChange: 'When the customer signals interest, immediately offer two specific time slots: "Great — I have Tuesday at 2pm or Wednesday at 10am. Which works better for you?"',
      findingIds: findings.filter(f => f.type === 'missed_opportunity').map(f => f.id),
      impact: 'high'
    })
  }

  if (findings.some(f => f.type === 'failure')) {
    recs.push({
      id: '',
      target: 'prompt',
      title: 'Strengthen de-escalation handling',
      rationale: 'The agent did not detect or respond to customer frustration, risking churn.',
      suggestedChange: 'Add to the system prompt: "If the customer expresses frustration, acknowledge it explicitly, apologize once, and offer to connect them to a human specialist before continuing."',
      findingIds: findings.filter(f => f.type === 'failure').map(f => f.id),
      impact: 'high'
    })
  }

  if (findings.some(f => f.type === 'deviation')) {
    recs.push({
      id: '',
      target: 'training',
      title: 'Reinforce full script coverage',
      rationale: 'Scripted steps were rushed or skipped, undermining consistency and compliance.',
      suggestedChange: 'Coach the agent to confirm each qualification question is answered before advancing, and add a guardrail that prevents skipping mandatory disclosure steps.',
      findingIds: findings.filter(f => f.type === 'deviation').map(f => f.id),
      impact: 'medium'
    })
  }

  if (recs.length === 0) {
    recs.push({
      id: '',
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
/* Prompt parsing helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Pull criterion ids from the "Criteria:" lines of the user prompt. */
function extractCriterionIds(prompt: string): string[] {
  const ids: string[] = []
  const re = /\bid=([a-zA-Z0-9_-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(prompt)) !== null) {
    if (m[1]) ids.push(m[1])
  }
  return ids.length > 0 ? ids : ['goal_outcome']
}

/** Parse the turn-indexed transcript ("[0] agent: ...") from the user prompt. */
function parseTurns(prompt: string): ParsedTurn[] {
  const turns: ParsedTurn[] = []
  const re = /^\[(\d+)\]\s+(agent|customer):\s?(.*)$/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(prompt)) !== null) {
    turns.push({ idx: Number(m[1]), speaker: (m[2] ?? '').toLowerCase(), text: m[3] ?? '' })
  }
  return turns
}
