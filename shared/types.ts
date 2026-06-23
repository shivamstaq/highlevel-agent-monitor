// CREATED (our eval layer)
/**
 * Single source of truth for the Voice AI Observability Copilot — the CREATED
 * eval layer that sits on top of the BORROWED GHL mirror (`shared/ghl.ts`).
 *
 * These zod schemas validate:
 *   1. LLM output (the analysis engine emits JSON matching `AnalysisResultSchema`),
 *   2. API responses (Nitro routes under server/api return these shapes),
 *   3. UI props (the Vue dashboard imports the inferred types).
 *
 * Provenance rule (redesign §6): every persisted field traces to a captured
 * payload OR is explicitly flagged as MODELED. GHL-borrowed shapes live in
 * `shared/ghl.ts`; this file composes them and adds the observability layer
 * (success criteria, the three DAGs, conformance, findings, recs, timeline).
 */
import { z } from 'zod'
import {
  GhlAgentSchema,
  FlowGraphSchema
} from './ghl'

// Re-export the borrowed contract so downstream slices can import the whole
// domain from one place (`#shared/types`) while provenance stays legible.
export * from './ghl'

/* ============================================================================
 * Enums
 * ========================================================================== */
export const SeveritySchema = z.enum(['low', 'medium', 'high'])
export type Severity = z.infer<typeof SeveritySchema>

export const FindingTypeSchema = z.enum(['deviation', 'failure', 'missed_opportunity'])
export type FindingType = z.infer<typeof FindingTypeSchema>

export const CriterionKindSchema = z.enum(['outcome', 'behavior', 'compliance', 'tone'])
export type CriterionKind = z.infer<typeof CriterionKindSchema>

export const RecommendationTargetSchema = z.enum([
  'prompt',
  'flow_node',
  'agent_config',
  'training'
])
export type RecommendationTarget = z.infer<typeof RecommendationTargetSchema>

export const UseActionKindSchema = z.enum(['review', 'coach_agent', 'update_flow', 'escalate'])
export type UseActionKind = z.infer<typeof UseActionKindSchema>

/** Where a Call/Transcript came from. TRIAL/LIVE is on Call.callType (GHL `trialCall`). */
export const CallSourceSchema = z.enum(['poll', 'webhook', 'seed'])
export type CallSource = z.infer<typeof CallSourceSchema>

export const CallTypeSchema = z.enum(['LIVE', 'TRIAL'])
export type CallType = z.infer<typeof CallTypeSchema>

/** Our normalized speakers: GHL `agent`→agent (the AI), `user`→customer (the caller). */
export const SpeakerSchema = z.enum(['agent', 'customer'])
export type Speaker = z.infer<typeof SpeakerSchema>

export const NodeStatusSchema = z.enum(['hit', 'skipped', 'out_of_order', 'extra'])
export type NodeStatus = z.infer<typeof NodeStatusSchema>

/* ============================================================================
 * SuccessCriterion + Agent (our enriched view of a GHL agent)
 *
 * SuccessCriterion is DERIVED (criteria.ts) from the real `agentPrompt` + flow
 * nodes — flagged modeled-from-real. Agent wraps the borrowed GhlAgent + the
 * normalized FlowGraph + derived criteria + a sync timestamp.
 * ========================================================================== */
export const SuccessCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: CriterionKindSchema,
  weight: z.number().min(0).max(1),
  /** Natural-language rule the LLM checks the transcript against. */
  detector: z.string(),
  /** Provenance: which part of the real agent spec this was derived from. */
  derivedFrom: z.enum(['prompt', 'flow', 'welcome', 'modeled']).default('prompt')
})
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>

/** CREATED enriched agent: borrowed config + normalized flow + derived criteria. */
export const AgentSchema = z.object({
  ghl: GhlAgentSchema,
  flow: FlowGraphSchema,
  successCriteria: z.array(SuccessCriterionSchema).default([]),
  /** ISO timestamp of the last mirror/sync from GHL. */
  syncedAt: z.string()
})
export type Agent = z.infer<typeof AgentSchema>

/* ============================================================================
 * Stage vocabulary (R2 §1.4) — the agent's INFERRED conversational stages.
 *
 * `StageNode`s are the LLM-inferred conversational phases of ONE agent (e.g.
 * greeting / qualify / collect / confirm / close) — MEMBERSHIP is inferred from
 * THIS agent's prompt + flow + criteria, never a hardcoded enum. `AgentStageSet`
 * bundles them with the agent id + a spec hash so the inference is cache-keyed
 * and re-derived only when the agent spec changes. Turns are then labeled with a
 * `stageId` (see TurnEntry) and the timeline/conformance feed off that vocabulary.
 * ========================================================================== */
/** A per-checkpoint edge case: a caller path + how the agent should handle it. */
export const StageEdgeCaseSchema = z.object({
  /** The caller situation / interaction style (e.g. "caller is in a hurry"). */
  condition: z.string(),
  /** What the agent is expected to do when this condition occurs. */
  expectedBehavior: z.string()
})
export type StageEdgeCase = z.infer<typeof StageEdgeCaseSchema>

export const StageNodeSchema = z.object({
  /** Stable, unique slug id (e.g. `greeting`, `qualify_need`). */
  id: z.string(),
  /** Human-readable stage name. */
  label: z.string(),
  /** Coarse stage family (free-form slug, NOT a closed enum). */
  kind: z.string(),
  /** Whether the stage must occur every call or only under conditions. */
  obligation: z.enum(['required', 'conditional']),
  /**
   * What the agent SHOULD do at this checkpoint — the agent-level expectation
   * extracted from its agenda/script/instructions. Drives the expected-vs-actual
   * drift comparison. Defaulted for back-compat with stage sets stored before R3.
   */
  expectation: z.string().default(''),
  /** Known edge cases / interaction styles this checkpoint must handle. */
  edgeCases: z.array(StageEdgeCaseSchema).default([])
})
export type StageNode = z.infer<typeof StageNodeSchema>

/** The inferred stage vocabulary for one agent, cache-keyed by `specHash`. */
export const AgentStageSetSchema = z.object({
  agentId: z.string(),
  /** Hash of the agent spec the stages were inferred from (idempotency key). */
  specHash: z.string(),
  stages: z.array(StageNodeSchema)
})
export type AgentStageSet = z.infer<typeof AgentStageSetSchema>

/* ============================================================================
 * Call + Transcript (BORROWED data, our normalized projection)
 *
 * Call mirrors the call-log; Transcript is the normalized projection of
 * `transcriptWithToolCalls` (turns + inline actions), times in SECONDS.
 * ========================================================================== */
export const CallSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  contactId: z.string().optional(),
  /** ISO 8601 (GHL `createdAt`). */
  createdAt: z.string(),
  durationSec: z.number().nonnegative(),
  /** LIVE | TRIAL — from GHL `trialCall`; sandbox is TRIAL-only. */
  callType: CallTypeSchema,
  source: CallSourceSchema,
  /** Real call gist (GHL `summary`). */
  summary: z.string().optional(),
  /** Set once this call has been analyzed. */
  analysisId: z.string().optional()
})
export type Call = z.infer<typeof CallSchema>

/** A normalized spoken turn (from a GHL turn entry). */
export const TurnEntrySchema = z.object({
  idx: z.number().int().nonnegative(),
  role: SpeakerSchema, // 'agent' (AI) | 'customer' (caller)
  content: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  /**
   * LLM-INFERRED conversational stage this turn enacts (a `StageNode.id` from the
   * agent's `AgentStageSet`). Optional + back-compat: absent on un-labeled turns.
   */
  stageId: z.string().optional(),
  /** Substring of `content` the labeler cited as grounding for `stageId`. */
  evidence: z.string().optional()
})
export type TurnEntry = z.infer<typeof TurnEntrySchema>

/** A normalized inline tool execution (from a GHL `action_executed` entry). */
export const ActionEntrySchema = z.object({
  idx: z.number().int().nonnegative(),
  role: z.literal('action'),
  toolName: z.string(),
  toolType: z.string(),
  toolCallId: z.string(),
  atSec: z.number().nonnegative()
})
export type ActionEntry = z.infer<typeof ActionEntrySchema>

/** Discriminated union: a transcript entry is either a Turn or an Action. */
export const TranscriptEntrySchema = z.discriminatedUnion('role', [
  TurnEntrySchema.extend({ role: z.literal('agent') }),
  TurnEntrySchema.extend({ role: z.literal('customer') }),
  ActionEntrySchema
])
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>

export const TranscriptSchema = z.object({
  callId: z.string(),
  entries: z.array(TranscriptEntrySchema)
})
export type Transcript = z.infer<typeof TranscriptSchema>

/* ============================================================================
 * The three DAGs: Expected / Actual flow (Call Flow is the borrowed FlowGraph).
 * All share the borrowed FlowGraph shape so `<FlowCanvas>` renders them identically.
 * ========================================================================== */

/**
 * ExpectedFlow (CREATED) — BOTH layers:
 *  - `normative`: ideal DAG compiled from the agent design (flow + goal/criteria).
 *  - `perCall?`:  refined to what THIS caller's intent should have traversed.
 */
export const ExpectedFlowSchema = z.object({
  agentId: z.string(),
  normative: FlowGraphSchema,
  perCall: z
    .object({
      callId: z.string(),
      ideal: FlowGraphSchema
    })
    .optional()
})
export type ExpectedFlow = z.infer<typeof ExpectedFlowSchema>

/** ActualFlow (CREATED) — the executed-trace DAG built from the transcript. */
export const ActualFlowSchema = z.object({
  callId: z.string(),
  agentId: z.string(),
  /** Nodes actually traversed (subset/superset of the design, FlowGraph-shaped). */
  nodes: z.array(FlowGraphSchema.shape.nodes.element),
  /** Transitions actually taken, in order. */
  edges: z.array(FlowGraphSchema.shape.edges.element),
  /** Ordered list of nodeIds the call traversed. */
  path: z.array(z.string())
})
export type ActualFlow = z.infer<typeof ActualFlowSchema>

/* ============================================================================
 * Inferred Call Flow (inferredFlow.ts) — the agent's COMPLETE handling map.
 *
 * An LLM reads the agent's real instructions/prompt and reconstructs every route
 * the agent SHOULD take depending on how the caller engages — the main path plus
 * decision branches (question vs booking, wants a human, missing info, …), tool
 * calls, handoffs and end states. This is what a good agent *should* do, derived
 * from the prompt — NOT the borrowed GHL Agent-Studio flow graph.
 * ========================================================================== */
export const InferredFlowNodeKindSchema = z.enum([
  'start', // call begins
  'message', // the agent says / does something
  'decision', // a branch point (route depends on the caller)
  'collect', // gather information from the caller
  'tool', // invoke a tool / action
  'handoff', // escalate / transfer to a human
  'end' // call ends
])
export type InferredFlowNodeKind = z.infer<typeof InferredFlowNodeKindSchema>

export const InferredFlowNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: InferredFlowNodeKindSchema,
  /** One line: what the agent does / decides here. */
  description: z.string().default('')
})
export type InferredFlowNode = z.infer<typeof InferredFlowNodeSchema>

export const InferredFlowEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  /** The caller path / condition under which this route is taken (branch label). */
  condition: z.string().optional()
})
export type InferredFlowEdge = z.infer<typeof InferredFlowEdgeSchema>

export const InferredFlowSchema = z.object({
  agentId: z.string(),
  /** One-sentence gist of how this agent is meant to operate. */
  summary: z.string().default(''),
  nodes: z.array(InferredFlowNodeSchema),
  edges: z.array(InferredFlowEdgeSchema).default([]),
  /** Spec hash this was inferred from (cache key). */
  specHash: z.string().optional(),
  /** True when the deterministic fallback produced this (honesty). */
  usedFallback: z.boolean().optional()
})
export type InferredFlow = z.infer<typeof InferredFlowSchema>

/* ============================================================================
 * Flow Alignment (flowAlignment.ts) — the per-call DRIFT OVERLAY on the inferred
 * flow. For each intended-flow node: did THIS call follow it (on_track), deviate
 * (drifted), skip it (skipped), or never reach it (not_reached)? Plus `tangents`:
 * points where the agent went off the intended flow entirely, with what it did
 * and how it should have re-aligned. This is what paints the flow-drift graph.
 * ========================================================================== */
export const FlowAlignmentStatusSchema = z.enum(['on_track', 'drifted', 'skipped', 'not_reached'])
export type FlowAlignmentStatus = z.infer<typeof FlowAlignmentStatusSchema>

export const FlowNodeAlignmentSchema = z.object({
  /** The InferredFlow node id this verdict is for. */
  nodeId: z.string(),
  status: FlowAlignmentStatusSchema,
  /** What the agent actually did at/around this node (one line). */
  actual: z.string().default(''),
  /** How it should have handled it / re-aligned (for drifted|skipped). */
  recommendation: z.string().default(''),
  evidenceEntryIdxs: z.array(z.number().int().nonnegative()).default([])
})
export type FlowNodeAlignment = z.infer<typeof FlowNodeAlignmentSchema>

/** A point where the call went OFF the intended flow (a tangential branch). */
export const FlowTangentSchema = z.object({
  id: z.string(),
  /** The last on-track node before the agent went off-script. */
  afterNodeId: z.string(),
  /** Short label: what the agent did instead. */
  label: z.string(),
  /** Detail of the off-script behavior. */
  description: z.string().default(''),
  /** How it should have re-aligned (which intended node / per instructions). */
  recommendation: z.string().default(''),
  evidenceEntryIdxs: z.array(z.number().int().nonnegative()).default([])
})
export type FlowTangent = z.infer<typeof FlowTangentSchema>

export const FlowAlignmentSchema = z.object({
  callId: z.string(),
  /** One line: how closely the call tracked the intended flow. */
  summary: z.string().default(''),
  nodeAlignments: z.array(FlowNodeAlignmentSchema).default([]),
  tangents: z.array(FlowTangentSchema).default([])
})
export type FlowAlignment = z.infer<typeof FlowAlignmentSchema>

/* ============================================================================
 * Conformance / drift (deterministic alignment — conformance.ts)
 * ========================================================================== */
export const NodeAlignmentSchema = z.object({
  nodeId: z.string(),
  displayName: z.string(),
  status: NodeStatusSchema, // hit | skipped | out_of_order | extra
  driftScore: z.number().min(0).max(1), // 0 = perfect, 1 = max drift
  /** Transcript entry idxs that enacted this node — drives transcript highlight. */
  matchedEntryIdxs: z.array(z.number().int().nonnegative()).default([])
})
export type NodeAlignment = z.infer<typeof NodeAlignmentSchema>

/** A transition the call took that is NOT in the expected graph (drift). */
export const DriftEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  reason: z.string().optional()
})
export type DriftEdge = z.infer<typeof DriftEdgeSchema>

export const FlowConformanceSchema = z.object({
  callId: z.string(),
  versionId: z.string(),
  /** Headline 0–100: how closely actual followed the expected flow. */
  conformanceScore: z.number().min(0).max(100),
  /** Process-mining fitness 0–1. */
  fitness: z.number().min(0).max(1),
  nodeAlignments: z.array(NodeAlignmentSchema),
  driftEdges: z.array(DriftEdgeSchema).default([])
})
export type FlowConformance = z.infer<typeof FlowConformanceSchema>

/* ============================================================================
 * Checkpoint drift (checkpoints.ts) — the PRIMARY analysis output.
 *
 * For each self-identified conversational checkpoint (StageNode) we compare what
 * SHOULD have happened (the agent-level `expectation`) against what ACTUALLY
 * happened on THIS call, accounting for per-call edge cases / interaction styles.
 * Status is an LLM verdict grounded in cited transcript entries.
 * ========================================================================== */
export const CheckpointStatusSchema = z.enum(['met', 'partial', 'missed', 'not_applicable'])
export type CheckpointStatus = z.infer<typeof CheckpointStatusSchema>

export const CheckpointReportSchema = z.object({
  /** The StageNode.id this checkpoint corresponds to. */
  stageId: z.string(),
  /** Human-readable checkpoint name (mirrors StageNode.label). */
  label: z.string(),
  obligation: z.enum(['required', 'conditional']),
  /** Verdict for THIS call: met | partial | missed | not_applicable. */
  status: CheckpointStatusSchema,
  /** One line: what the agent was expected to do at this checkpoint. */
  expected: z.string(),
  /** One line: what the agent actually did on this call. */
  actual: z.string(),
  /** How an edge case / unusual interaction style was (or wasn't) handled. */
  edgeCaseNote: z.string().optional(),
  /** Transcript entry idxs that enacted (or should have enacted) this checkpoint. */
  evidenceEntryIdxs: z.array(z.number().int().nonnegative()).default([])
})
export type CheckpointReport = z.infer<typeof CheckpointReportSchema>

/* ============================================================================
 * Call Timeline (timeline.ts) — REAL headline latency + MODELED sub-stages.
 *
 * `source: 'partial-real'` is the honesty flag: per-turn latency is REAL
 * (transcriptWithToolCalls times), the per-stage VAD/STT/EOU/LLM/TTS breakdown
 * inside `events[]` is MODELED (not exposed by GHL) and labeled as such.
 * ========================================================================== */
export const TimelineStageSchema = z.enum([
  'user_speech',
  'vad',
  'stt',
  'eou',
  'llm',
  'tts',
  'agent_speech',
  'interruption'
])
export type TimelineStage = z.infer<typeof TimelineStageSchema>

export const CallEventSchema = z.object({
  id: z.string(),
  callId: z.string(),
  /** Transcript entry idx this event belongs to (when applicable). */
  entryIdx: z.number().int().nonnegative().optional(),
  stage: TimelineStageSchema,
  /** 'real' for turn boundaries from GHL times; 'modeled' for synthesized sub-stages. */
  provenance: z.enum(['real', 'modeled']),
  tStartMs: z.number().nonnegative(),
  tEndMs: z.number().nonnegative(),
  latencyMs: z.number().nonnegative().optional()
})
export type CallEvent = z.infer<typeof CallEventSchema>

/** Per-turn response latency (REAL): gap from caller end → next agent start. */
export const PerTurnLatencySchema = z.object({
  /** Idx of the agent turn that responded. */
  agentEntryIdx: z.number().int().nonnegative(),
  /** Idx of the preceding customer turn. */
  customerEntryIdx: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative()
})
export type PerTurnLatency = z.infer<typeof PerTurnLatencySchema>

export const CallTimelineSchema = z.object({
  callId: z.string(),
  /** Honesty flag: REAL turn latency + MODELED sub-stages. */
  source: z.literal('partial-real'),
  /** Headline metric (REAL): mean caller-end → agent-start latency. */
  avgResponseLatencyMs: z.number().nonnegative(),
  /** REAL per-turn latencies. */
  perTurnLatency: z.array(PerTurnLatencySchema),
  /** Sub-stage events — MODELED entries flagged via CallEvent.provenance. */
  events: z.array(CallEventSchema),
  /** REAL barge-in proxy (overlapping turn count). */
  interruptionCount: z.number().int().nonnegative(),
  totalMs: z.number().nonnegative()
})
export type CallTimeline = z.infer<typeof CallTimelineSchema>

/* ============================================================================
 * Analysis output (analysis.ts) — ALSO the JSON contract handed to the LLM.
 * Findings cite `evidenceEntryIdxs` (indices into Transcript.entries).
 * ========================================================================== */
export const CriterionScoreSchema = z.object({
  criterionId: z.string(),
  met: z.boolean(),
  score: z.number().min(0).max(100),
  evidence: z.string()
})
export type CriterionScore = z.infer<typeof CriterionScoreSchema>

export const ScorecardSchema = z.object({
  overall: z.number().min(0).max(100),
  perCriterion: z.array(CriterionScoreSchema)
})
export type Scorecard = z.infer<typeof ScorecardSchema>

export const FindingSchema = z.object({
  id: z.string(),
  type: FindingTypeSchema,
  criterionId: z.string().optional(),
  severity: SeveritySchema,
  title: z.string(),
  detail: z.string(),
  /** Indices into Transcript.entries — drives transcript highlighting. */
  evidenceEntryIdxs: z.array(z.number().int().nonnegative()).default([])
})
export type Finding = z.infer<typeof FindingSchema>

export const RecommendationSchema = z.object({
  id: z.string(),
  target: RecommendationTargetSchema, // prompt | flow_node | agent_config | training
  title: z.string(),
  rationale: z.string(),
  /** Paste-ready snippet the operator can apply. */
  suggestedChange: z.string(),
  findingIds: z.array(z.string()).default([]),
  impact: SeveritySchema
})
export type Recommendation = z.infer<typeof RecommendationSchema>

/** "Use Action" — a call segment needing human intervention or flow training. */
export const UseActionSchema = z.object({
  id: z.string(),
  callId: z.string(),
  reason: z.string(),
  /** [startEntryIdx, endEntryIdx] into Transcript.entries. */
  entryRange: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative()
  ]),
  recommendedAction: UseActionKindSchema
})
export type UseAction = z.infer<typeof UseActionSchema>

/**
 * The free-of-bookkeeping shape the LLM must return (handed to
 * anthropic/ollama/mock verbatim as the JSON format contract).
 */
export const AnalysisResultSchema = z.object({
  summary: z.string(),
  scorecard: ScorecardSchema,
  findings: z.array(FindingSchema),
  recommendations: z.array(RecommendationSchema),
  useActions: z.array(UseActionSchema)
})
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>

/** The persisted analysis = LLM result + conformance + timeline + bookkeeping. */
export const AnalysisSchema = AnalysisResultSchema.extend({
  id: z.string(),
  callId: z.string(),
  agentId: z.string(),
  /** Deterministic flow conformance of actual vs expected. */
  conformance: FlowConformanceSchema.optional(),
  /** PRIMARY: per-checkpoint expected-vs-actual drift (LLM verdicts). */
  checkpoints: z.array(CheckpointReportSchema).default([]),
  /** PRIMARY (R3): drift overlay of this call onto the agent's inferred flow. */
  flowAlignment: FlowAlignmentSchema.optional(),
  /** REAL + MODELED voice-pipeline timeline. */
  timeline: CallTimelineSchema.optional(),
  /** The agent's LLM-inferred stage vocabulary used to label this call's turns. */
  stageSet: AgentStageSetSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  /** True when deterministic-fallback output stood in for a real provider call. */
  usedFallback: z.boolean().optional(),
  /** Idempotency key — re-analysis is skipped when the transcript is unchanged. */
  transcriptHash: z.string().optional(),
  createdAt: z.string()
})
export type Analysis = z.infer<typeof AnalysisSchema>

/* ============================================================================
 * Analysis run status (analysisStatus store) — drives the live, reactive
 * step-by-step progress UI and the single-flight guard (a call already being
 * analyzed cannot be re-triggered). Persisted in the data store per callId.
 * ========================================================================== */
export const AnalysisStepStateSchema = z.enum(['pending', 'active', 'done', 'error', 'skipped'])
export type AnalysisStepState = z.infer<typeof AnalysisStepStateSchema>

export const AnalysisStepSchema = z.object({
  /** Stable step id (e.g. `criteria`, `checkpoints`, `labeling`, `drift`, `scoring`). */
  id: z.string(),
  label: z.string(),
  state: AnalysisStepStateSchema,
  /** Optional one-line detail shown under the step while/after it runs. */
  detail: z.string().optional()
})
export type AnalysisStep = z.infer<typeof AnalysisStepSchema>

export const AnalysisRunStateSchema = z.enum(['running', 'done', 'error'])
export type AnalysisRunState = z.infer<typeof AnalysisRunStateSchema>

export const AnalysisStatusSchema = z.object({
  callId: z.string(),
  state: AnalysisRunStateSchema,
  steps: z.array(AnalysisStepSchema),
  /** ISO timestamps — used to detect a stale/abandoned run. */
  startedAt: z.string(),
  updatedAt: z.string(),
  /** Set when state==='error'. */
  error: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional()
})
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>

/* ============================================================================
 * API response composites (what the dashboard consumes — M5 rollup)
 * ========================================================================== */
export const AgentHealthSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  callsAnalyzed: z.number().int().nonnegative(),
  avgScore: z.number().min(0).max(100),
  failureRate: z.number().min(0).max(1),
  openUseActions: z.number().int().nonnegative(),
  /** Mean flow adherence (0–100, from flowAlignment) over scored calls; null when none. */
  avgFlowAdherence: z.number().min(0).max(100).nullable(),
  /** Success-criteria pass rate (0–1); null when no analyzed calls. */
  criteriaMetRate: z.number().min(0).max(1).nullable(),
  lastAnalyzedAt: z.string().optional()
})
export type AgentHealth = z.infer<typeof AgentHealthSchema>

/** A recommendation tagged with its source call/agent for the fix-queue deep-links. */
export const RecommendationItemSchema = z.object({
  recommendation: RecommendationSchema,
  callId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  callScore: z.number().min(0).max(100).optional(),
  callCreatedAt: z.string().optional(),
  /** How many calls raised this same advice (dedup bucket size). */
  callCount: z.number().int().nonnegative(),
  /** How many distinct agents raised it across the fleet. */
  agentCount: z.number().int().nonnegative(),
  agentNames: z.array(z.string()).optional()
})
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>

export const FleetStatsSchema = z.object({
  fleetHealth: z.number().min(0).max(100),
  callsAnalyzed: z.number().int().nonnegative(),
  failureRate: z.number().min(0).max(1),
  openUseActions: z.number().int().nonnegative(),
  /** Average score per day for the trend chart. */
  trend: z.array(z.object({ date: z.string(), score: z.number() })),
  agents: z.array(AgentHealthSchema),
  topRecommendations: z.array(RecommendationItemSchema)
})
export type FleetStats = z.infer<typeof FleetStatsSchema>

export const CallDetailSchema = z.object({
  call: CallSchema,
  agent: AgentSchema,
  transcript: TranscriptSchema,
  analysis: AnalysisSchema.nullable(),
  /** The three DAGs for this call's Eval tab. */
  expectedFlow: ExpectedFlowSchema.nullable(),
  actualFlow: ActualFlowSchema.nullable(),
  /** The agent's LLM-inferred intended call flow (drift-graph backbone). */
  inferredFlow: InferredFlowSchema.nullable()
})
export type CallDetail = z.infer<typeof CallDetailSchema>

export const CallListItemSchema = z.object({
  call: CallSchema,
  agentName: z.string(),
  score: z.number().min(0).max(100).nullable(),
  topSeverity: SeveritySchema.nullable(),
  findingCount: z.number().int().nonnegative(),
  /** Flow adherence 0–100 (from flowAlignment); null until analyzed. */
  flowAdherence: z.number().min(0).max(100).nullable()
})
export type CallListItem = z.infer<typeof CallListItemSchema>
