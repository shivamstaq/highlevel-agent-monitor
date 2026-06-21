/**
 * Single source of truth for the Voice AI Observability Copilot domain.
 *
 * These zod schemas validate:
 *   1. LLM output (the analysis engine emits JSON matching `AnalysisSchema`),
 *   2. API responses (Nitro routes return these shapes),
 *   3. UI props (the Vue dashboard imports the inferred types).
 *
 * Every slice (data, api, llm, ui, ghl, docs) reads this file as the frozen contract.
 */
import { z } from 'zod'

/* ----------------------------------------------------------------------------
 * Enums
 * ------------------------------------------------------------------------- */
export const SeveritySchema = z.enum(['low', 'medium', 'high'])
export type Severity = z.infer<typeof SeveritySchema>

export const FindingTypeSchema = z.enum(['deviation', 'failure', 'missed_opportunity'])
export type FindingType = z.infer<typeof FindingTypeSchema>

export const CriterionKindSchema = z.enum(['outcome', 'behavior', 'compliance', 'tone'])
export type CriterionKind = z.infer<typeof CriterionKindSchema>

export const RecommendationTargetSchema = z.enum(['prompt', 'script', 'agent_config', 'training'])
export type RecommendationTarget = z.infer<typeof RecommendationTargetSchema>

export const UseActionKindSchema = z.enum(['review', 'coach_agent', 'update_script', 'escalate'])
export type UseActionKind = z.infer<typeof UseActionKindSchema>

export const CallSourceSchema = z.enum(['webhook', 'poll', 'seed'])
export type CallSource = z.infer<typeof CallSourceSchema>

export const SpeakerSchema = z.enum(['agent', 'customer'])
export type Speaker = z.infer<typeof SpeakerSchema>

/* ----------------------------------------------------------------------------
 * Agent + observability parameters (the "Monitor" setup)
 * ------------------------------------------------------------------------- */
export const SuccessCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: CriterionKindSchema,
  weight: z.number().min(0).max(1),
  /** Natural-language rule the LLM checks the transcript against. */
  detector: z.string()
})
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** What success means for this agent. */
  goal: z.string(),
  /** The system prompt / script the agent runs. */
  script: z.string().optional().default(''),
  successCriteria: z.array(SuccessCriterionSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Agent = z.infer<typeof AgentSchema>

/* ----------------------------------------------------------------------------
 * Call + transcript
 * ------------------------------------------------------------------------- */
export const TurnSchema = z.object({
  idx: z.number().int().nonnegative(),
  speaker: SpeakerSchema,
  text: z.string(),
  tsSec: z.number().nonnegative().optional()
})
export type Turn = z.infer<typeof TurnSchema>

export const TranscriptSchema = z.object({
  callId: z.string(),
  turns: z.array(TurnSchema)
})
export type Transcript = z.infer<typeof TranscriptSchema>

export const CallSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  durationSec: z.number().nonnegative(),
  outcome: z.string().optional(),
  recordingUrl: z.string().optional(),
  contactName: z.string().optional(),
  startedAt: z.string(),
  source: CallSourceSchema,
  analysisId: z.string().optional()
})
export type Call = z.infer<typeof CallSchema>

/* ----------------------------------------------------------------------------
 * Expected Call Flow (design intent — generated at agent creation)
 *
 * The agent's goal/script compiled into a decision graph BEFORE any call. This is
 * the "observability parameter set": at analysis time the actual call is aligned
 * to this graph (process-mining conformance) to measure drift.
 * ------------------------------------------------------------------------- */
export const FlowNodeKindSchema = z.enum([
  'greeting', 'intent', 'qualify', 'collect', 'confirm', 'objection', 'action', 'close'
])
export type FlowNodeKind = z.infer<typeof FlowNodeKindSchema>

export const FlowNodeSchema = z.object({
  id: z.string(), // stable slug, e.g. 'collect_callback'
  label: z.string(),
  kind: FlowNodeKindSchema,
  /** true = should occur on every call; false = conditional branch (skipping is NOT drift). */
  expected: z.boolean().default(true),
  branchConditions: z.array(z.string()).default([])
})
export type FlowNode = z.infer<typeof FlowNodeSchema>

export const FlowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.string().optional()
})
export type FlowEdge = z.infer<typeof FlowEdgeSchema>

/** What the LLM emits (no bookkeeping fields). */
export const ExpectedFlowResultSchema = z.object({
  nodes: z.array(FlowNodeSchema).min(2).max(12),
  edges: z.array(FlowEdgeSchema)
})
export type ExpectedFlowResult = z.infer<typeof ExpectedFlowResultSchema>

export const ExpectedFlowSchema = ExpectedFlowResultSchema.extend({
  agentId: z.string(),
  provider: z.string(),
  model: z.string(),
  specHash: z.string(), // hash(goal+script+criteria) — idempotent regen + auto-invalidate
  createdAt: z.string()
})
export type ExpectedFlow = z.infer<typeof ExpectedFlowSchema>

/* ----------------------------------------------------------------------------
 * Call Event Timeline (realtime voice-pipeline trace)
 *
 * Models the LiveKit-style pipeline: VAD -> STT -> EOU -> LLM -> TTS -> audio out.
 * Turn boundaries can be REAL (ingested from a per-sentence transcription) while
 * the per-stage latency decomposition is MODELED on published LiveKit budgets.
 * latency identity: e2e_latency ~= end_of_utterance_delay + llm.ttft + tts.ttfb
 * ------------------------------------------------------------------------- */
export const StageSchema = z.enum([
  'user_speech', 'vad', 'stt', 'eou', 'llm', 'tts', 'agent_speech', 'interruption'
])
export type Stage = z.infer<typeof StageSchema>

export const CallEventSchema = z.object({
  id: z.string(),
  callId: z.string(),
  turnIdx: z.number().int().nonnegative().optional(),
  stage: StageSchema,
  type: z.string(), // 'partial' | 'final' | 'ttft' | 'ttfb' | 'speech' | 'barge_in' | ...
  tStartMs: z.number().nonnegative(),
  tEndMs: z.number().nonnegative(),
  latencyMs: z.number().nonnegative().optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({})
})
export type CallEvent = z.infer<typeof CallEventSchema>

export const StageLatencySchema = z.object({
  stage: StageSchema,
  p50Ms: z.number(),
  p95Ms: z.number(),
  maxMs: z.number(),
  count: z.number().int()
})
export type StageLatency = z.infer<typeof StageLatencySchema>

export const CallTimelineSchema = z.object({
  callId: z.string(),
  source: z.enum(['modeled', 'ingested']), // honesty flag, surfaced in UI
  modelVersion: z.string(),
  events: z.array(CallEventSchema),
  perStageLatency: z.array(StageLatencySchema),
  interruptionCount: z.number().int().nonnegative(),
  avgResponseLatencyMs: z.number().nonnegative(), // EOU end -> first agent audio (headline metric)
  totalMs: z.number().nonnegative()
})
export type CallTimeline = z.infer<typeof CallTimelineSchema>

/* ----------------------------------------------------------------------------
 * Flow conformance / drift (process-mining alignment)
 * ------------------------------------------------------------------------- */
export const NodeStatusSchema = z.enum(['hit', 'skipped', 'out_of_order', 'extra'])
export type NodeStatus = z.infer<typeof NodeStatusSchema>

export const NodeAlignmentSchema = z.object({
  nodeId: z.string().optional(), // expected node id (absent for 'extra')
  label: z.string(),
  kind: FlowNodeKindSchema,
  status: NodeStatusSchema,
  driftScore: z.number().min(0).max(1), // 0 = perfect, 1 = max drift
  matchedTurnIdxs: z.array(z.number().int().nonnegative()).default([]),
  note: z.string().optional()
})
export type NodeAlignment = z.infer<typeof NodeAlignmentSchema>

export const FlowAlignmentSchema = z.object({
  callId: z.string(),
  agentId: z.string(),
  conformanceScore: z.number().min(0).max(100), // headline: how closely actual followed intent
  fitness: z.number().min(0).max(1), // process-mining fitness
  nodeAlignments: z.array(NodeAlignmentSchema),
  actualPath: z.array(z.string()) // node ids the call actually traversed, in order
})
export type FlowAlignment = z.infer<typeof FlowAlignmentSchema>

/** LLM-assigned mapping of a transcript turn to its enacted flow node. */
export const StageLabelSchema = z.object({
  turnIdx: z.number().int().nonnegative(),
  nodeId: z.string().nullable(),
  kind: FlowNodeKindSchema
})
export type StageLabel = z.infer<typeof StageLabelSchema>

/* ----------------------------------------------------------------------------
 * Analysis output (this schema is ALSO emitted to the LLM as its JSON contract)
 * ------------------------------------------------------------------------- */
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
  /** Indices into Transcript.turns — drives transcript highlighting in the UI. */
  evidenceTurnIdxs: z.array(z.number().int().nonnegative()).default([])
})
export type Finding = z.infer<typeof FindingSchema>

export const RecommendationSchema = z.object({
  id: z.string(),
  target: RecommendationTargetSchema,
  title: z.string(),
  rationale: z.string(),
  /** Paste-ready snippet the operator can apply. */
  suggestedChange: z.string(),
  findingIds: z.array(z.string()).default([]),
  impact: SeveritySchema
})
export type Recommendation = z.infer<typeof RecommendationSchema>

/** "Use Action" — a call segment that needs human intervention or script training. */
export const UseActionSchema = z.object({
  id: z.string(),
  callId: z.string(),
  reason: z.string(),
  turnRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  recommendedAction: UseActionKindSchema
})
export type UseAction = z.infer<typeof UseActionSchema>

/**
 * The shape the LLM must return. Kept free of DB/bookkeeping fields so it can be
 * handed to Ollama (`format`) / Anthropic (`output_config.format`) verbatim.
 */
export const AnalysisResultSchema = z.object({
  summary: z.string(),
  scorecard: ScorecardSchema,
  findings: z.array(FindingSchema),
  recommendations: z.array(RecommendationSchema),
  useActions: z.array(UseActionSchema),
  /** Per-turn mapping to the expected-flow node it enacts; drives conformance. */
  stageLabels: z.array(StageLabelSchema).default([])
})
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>

/** The persisted analysis = LLM result + bookkeeping. */
export const AnalysisSchema = AnalysisResultSchema.extend({
  id: z.string(),
  callId: z.string(),
  agentId: z.string(),
  provider: z.string(),
  model: z.string(),
  transcriptHash: z.string(),
  createdAt: z.string(),
  /** Drift of the actual call against the agent's expected flow. */
  flowAlignment: FlowAlignmentSchema.optional()
})
export type Analysis = z.infer<typeof AnalysisSchema>

/* ----------------------------------------------------------------------------
 * API response composites (what the dashboard consumes)
 * ------------------------------------------------------------------------- */
export const AgentHealthSchema = z.object({
  agent: AgentSchema,
  callsAnalyzed: z.number().int().nonnegative(),
  avgScore: z.number().min(0).max(100),
  failureRate: z.number().min(0).max(1),
  openUseActions: z.number().int().nonnegative(),
  lastAnalyzedAt: z.string().optional()
})
export type AgentHealth = z.infer<typeof AgentHealthSchema>

export const FleetStatsSchema = z.object({
  fleetHealth: z.number().min(0).max(100),
  callsAnalyzed: z.number().int().nonnegative(),
  failureRate: z.number().min(0).max(1),
  openUseActions: z.number().int().nonnegative(),
  /** Average score per day for the trend chart. */
  trend: z.array(z.object({ date: z.string(), score: z.number() })),
  agents: z.array(AgentHealthSchema),
  topRecommendations: z.array(RecommendationSchema)
})
export type FleetStats = z.infer<typeof FleetStatsSchema>

export const CallDetailSchema = z.object({
  call: CallSchema,
  agent: AgentSchema,
  transcript: TranscriptSchema,
  analysis: AnalysisSchema.nullable(),
  timeline: CallTimelineSchema.nullable(),
  expectedFlow: ExpectedFlowSchema.nullable()
})
export type CallDetail = z.infer<typeof CallDetailSchema>

export const CallListItemSchema = z.object({
  call: CallSchema,
  agentName: z.string(),
  score: z.number().min(0).max(100).nullable(),
  topSeverity: SeveritySchema.nullable(),
  findingCount: z.number().int().nonnegative()
})
export type CallListItem = z.infer<typeof CallListItemSchema>
