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
  useActions: z.array(UseActionSchema)
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
  createdAt: z.string()
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
  analysis: AnalysisSchema.nullable()
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
