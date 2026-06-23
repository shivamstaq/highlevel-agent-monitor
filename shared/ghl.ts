// BORROWED (mirrors GHL)
/**
 * Borrowed HighLevel shapes — a read-only mirror of what the GHL API returns.
 *
 * Every schema here traces to a captured payload under `docs/captures/`:
 *   - GhlAgent              ← `10-agent-config.json`  (GET /voice-ai/agents/:id)
 *   - GhlCallLog            ← `22-call-A-listitem-full.json` / `31-call-B-listitem-full.json`
 *                              (GET /voice-ai/dashboard/call-logs list item — carries FULL data)
 *   - GhlTranscriptEntry    ← `transcriptWithToolCalls[]` inside the call-log captures
 *   - GhlFlowVersionRaw     ← `40-flow-version.json`.version (GET /agent-studio/agents/versions/:versionId)
 *   - FlowGraph/FlowNode/FlowEdge — the NORMALIZED, Vue-Flow-shaped projection of the raw
 *                              flow version that all three DAGs (Call Flow / Expected / Actual) render.
 *
 * Convention: raw GHL shapes are deliberately lenient (`.passthrough()` / `.optional()`)
 * because GHL returns conditional, often-empty fields (see platform.md §4). The normalized
 * FlowGraph is strict — it is the contract our UI and eval engine depend on.
 */
import { z } from 'zod'

/* ============================================================================
 * 1. GhlAgent  ← docs/captures/10-agent-config.json (GET /voice-ai/agents/:id)
 *
 * One unified agent record; `agentType` discriminates and `llmVersionId` points
 * at the Agent Studio flow version (the join: call → agent → flow graph).
 * Lenient on the long tail of config fields GHL returns; the redesign §2 subset
 * is required, the rest are optional passthrough so we never drop real data.
 * ========================================================================== */

/** Post-call notification routing block (object on the real agent record). */
export const GhlPostCallNotificationSchema = z
  .object({
    admins: z.boolean().optional(),
    allUsers: z.boolean().optional(),
    contactAssignedUser: z.boolean().optional(),
    specificUsers: z.array(z.string()).optional(),
    customEmails: z.array(z.string()).optional()
  })
  .passthrough()
export type GhlPostCallNotification = z.infer<typeof GhlPostCallNotificationSchema>

export const GhlTranslationSchema = z.object({ enabled: z.boolean() }).passthrough()
export type GhlTranslation = z.infer<typeof GhlTranslationSchema>

export const GhlAgentSchema = z
  .object({
    // ── required identity / join keys (verified always present) ──
    id: z.string(),
    locationId: z.string(),
    agentName: z.string(),
    businessName: z.string(),
    // agentType / llmVersionId are absent on a freshly-created or unpublished
    // (draft) agent in GHL — defaulted so a draft still parses and can be
    // mirrored (our analysis is prompt-driven, not flow-graph-driven).
    agentType: z.string().optional().default(''), // e.g. 'CUSTOM_LLM'
    language: z.string(), // 'en-US'
    voiceId: z.string(),
    welcomeMessage: z.string(),
    agentPrompt: z.string(),
    /** Points at the Agent Studio flow version → GhlFlowVersionRaw. Absent until published. */
    llmVersionId: z.string().optional().default(''),

    // ── config surface (redesign §2 + observed real keys) ──
    responsiveness: z.number().optional(),
    maxCallDuration: z.number().optional(),
    sendUserIdleReminders: z.boolean().optional(),
    reminderAfterIdleTimeSeconds: z.number().optional(),
    toolCallStrictMode: z.boolean().optional(),
    timezone: z.string().optional(),
    inboundNumber: z.string().nullable().optional(),
    inboundNumbers: z.array(z.string()).optional(),
    isAgentAsBackupDisabled: z.boolean().optional(),
    agentWorkingHours: z.array(z.unknown()).optional(),
    callEndWorkflowIds: z.array(z.string()).optional(),
    sendPostCallNotificationTo: GhlPostCallNotificationSchema.optional(),
    translation: GhlTranslationSchema.nullable().optional(),
    // `prompts` was `{}` (object) on the real agent; keep lenient.
    prompts: z.unknown().optional(),
    actions: z.array(z.unknown()).optional(),
    customLlmId: z.string().optional(),
    customLlmUrl: z.string().optional(),
    updatedAt: z.string().optional(),
    traceId: z.string().optional()
  })
  .passthrough()
export type GhlAgent = z.infer<typeof GhlAgentSchema>

/* ============================================================================
 * 2. Call log + transcriptWithToolCalls  ← docs/captures/22-*, 31-*
 *
 * The LIST endpoint item carries FULL data (richer than detail). We ingest from
 * the list. `transcriptWithToolCalls` is the authoritative timed transcript.
 * ========================================================================== */

/** A spoken turn: role 'agent' (the AI) or 'user' (the caller). Times in SECONDS (float). */
export const GhlTranscriptTurnSchema = z.object({
  role: z.enum(['agent', 'user']),
  content: z.string(),
  startTime: z.number(),
  endTime: z.number()
})
export type GhlTranscriptTurn = z.infer<typeof GhlTranscriptTurnSchema>

/** An inline tool execution (e.g. the automatic `end_call`). No endTime — point event. */
export const GhlTranscriptActionSchema = z.object({
  role: z.literal('action_executed'),
  toolName: z.string(),
  toolType: z.string(),
  toolCallId: z.string(),
  startTime: z.number()
})
export type GhlTranscriptAction = z.infer<typeof GhlTranscriptActionSchema>

/** Union entry of `transcriptWithToolCalls`. Discriminated on `role`. */
export const GhlTranscriptEntrySchema = z.union([
  GhlTranscriptActionSchema, // try the literal first so 'action_executed' wins
  GhlTranscriptTurnSchema
])
export type GhlTranscriptEntry = z.infer<typeof GhlTranscriptEntrySchema>

/** A single call-log LIST item (the FULL-data shape we ingest). */
export const GhlCallLogSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    contactId: z.string().optional().default(''),
    createdAt: z.string(), // ISO 8601
    duration: z.number(), // seconds
    trialCall: z.boolean(),
    summary: z.string().optional().default(''),
    /** Lossy flat transcript — fallback/display only. */
    transcript: z.string().optional().default(''),
    /** Authoritative timed transcript with inline tool calls. */
    transcriptWithToolCalls: z.array(GhlTranscriptEntrySchema).default([]),
    // ── conditional / often-empty fields (platform.md §4) ──
    extractedData: z.record(z.string(), z.unknown()).optional().default({}),
    executedCallActions: z.array(z.unknown()).optional().default([]),
    translation: z.unknown().nullable().optional(),
    isAgentDeleted: z.boolean().optional().default(false),
    messageId: z.string().optional(),
    fromNumber: z.string().optional(),
    recordingUrl: z.string().optional()
  })
  .passthrough()
export type GhlCallLog = z.infer<typeof GhlCallLogSchema>

/** Envelope of GET /voice-ai/dashboard/call-logs (⚠️ {callLogs,totalRecords,traceId}). */
export const GhlCallLogsResponseSchema = z
  .object({
    callLogs: z.array(GhlCallLogSchema).default([]),
    totalRecords: z.number().nullable().optional(),
    traceId: z.string().optional()
  })
  .passthrough()
export type GhlCallLogsResponse = z.infer<typeof GhlCallLogsResponseSchema>

/** Envelope of GET /voice-ai/agents (the agents list). */
export const GhlAgentsResponseSchema = z
  .object({
    agents: z.array(GhlAgentSchema).default([]),
    page: z.number().optional(),
    pageSize: z.number().optional(),
    total: z.number().optional(),
    traceId: z.string().optional()
  })
  .passthrough()
export type GhlAgentsResponse = z.infer<typeof GhlAgentsResponseSchema>

/* ============================================================================
 * 3. GhlFlowVersionRaw  ← docs/captures/40-flow-version.json.version
 *    (GET /agent-studio/agents/versions/:versionId → { success, message, version })
 *
 * The raw Agent Studio flow graph. `nodes[]` are the logical nodes (nodeId,
 * nodeType, nodeConfig…), `edges[]` are the logical transitions (with embedded
 * source/targetNode snapshots), and `uiNodes[]`/`uiEdges[]` carry Vue-Flow
 * geometry (position, dimensions). All deliberately lenient — these objects are
 * deeply nested and we only normalize the slice we need (see FlowGraph below).
 * ========================================================================== */

/** Raw logical node. nodeType ∈ {triggerNode, llmNode, routerNode, universalNode, actionNode, endCallNode}. */
export const GhlRawNodeSchema = z
  .object({
    nodeId: z.string(),
    nodeName: z.string(), // 'start_action' | 'ai_agent_node' | 'router' | 'updateContactField' …
    nodeDisplayName: z.string(), // 'Start Call' | 'AI Agent' | 'Router' | …
    nodeType: z.string(), // 'triggerNode' | 'llmNode' | 'universalNode' | …
    isStartNode: z.boolean().optional().default(false),
    isEndNode: z.boolean().optional().default(false),
    frontendNodeType: z.string().optional(), // 'start-action' | 'llm' | 'ai-router' | 'actions'
    nodeConfig: z.record(z.string(), z.unknown()).optional().default({}),
    data: z.unknown().optional()
  })
  .passthrough()
export type GhlRawNode = z.infer<typeof GhlRawNodeSchema>

/** Edge condition rule block (observed: `tool_name EQ <router|updateContactField>`). */
export const GhlEdgeConditionsSchema = z
  .object({
    type: z.string(), // 'AND' | 'OR'
    rules: z.array(
      z
        .object({
          operand: z.string(),
          operator: z.string(),
          value: z.unknown(),
          valueType: z.string().optional()
        })
        .passthrough()
    )
  })
  .passthrough()
export type GhlEdgeConditions = z.infer<typeof GhlEdgeConditionsSchema>

/** Raw logical edge. Carries source/target nodeIds, a human label, and conditions. */
export const GhlRawEdgeSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.string().optional(), // 'custom'
    label: z.string().optional(),
    animated: z.boolean().optional(),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
    conditions: GhlEdgeConditionsSchema.nullable().optional(),
    data: z.unknown().optional()
  })
  .passthrough()
export type GhlRawEdge = z.infer<typeof GhlRawEdgeSchema>

/** Vue-Flow geometry node (uiNodes[]): position + dimensions for layout. */
export const GhlUiNodeSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(), // 'start-action' | 'llm' | 'ai-router' | 'actions'
    position: z.object({ x: z.number(), y: z.number() }).passthrough(),
    dimensions: z
      .object({ width: z.number(), height: z.number() })
      .partial()
      .passthrough()
      .optional(),
    data: z.unknown().optional()
  })
  .passthrough()
export type GhlUiNode = z.infer<typeof GhlUiNodeSchema>

/** Vue-Flow geometry edge (uiEdges[]). Empty in the capture; kept lenient. */
export const GhlUiEdgeSchema = z
  .object({
    id: z.string(),
    source: z.string().optional(),
    target: z.string().optional()
  })
  .passthrough()
export type GhlUiEdge = z.infer<typeof GhlUiEdgeSchema>

export const GhlViewportSchema = z
  .object({ x: z.number(), y: z.number(), zoom: z.number() })
  .passthrough()
export type GhlViewport = z.infer<typeof GhlViewportSchema>

/** The raw flow version (the `.version` object of the agent-studio response). */
export const GhlFlowVersionRawSchema = z
  .object({
    id: z.string().optional(),
    versionId: z.string(),
    agentId: z.string().optional(),
    agencyId: z.string().optional(),
    locationId: z.string().optional(),
    versionName: z.string().optional(),
    flowName: z.string().optional(),
    description: z.string().optional(),
    state: z.string().optional(), // 'staging' | 'published' | …
    isPublished: z.boolean().optional().default(false),
    nodes: z.array(GhlRawNodeSchema).default([]),
    edges: z.array(GhlRawEdgeSchema).default([]),
    uiNodes: z.array(GhlUiNodeSchema).default([]),
    uiEdges: z.array(GhlUiEdgeSchema).default([]),
    globalVariables: z.array(z.unknown()).default([]),
    inputVariables: z.array(z.unknown()).default([]),
    runtimeVariables: z.array(z.unknown()).default([]),
    viewport: GhlViewportSchema.optional(),
    globalConfig: z.record(z.string(), z.unknown()).optional().default({}),
    publishedBy: z.string().optional(),
    publishedByName: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
  })
  .passthrough()
export type GhlFlowVersionRaw = z.infer<typeof GhlFlowVersionRawSchema>

/** Full agent-studio response envelope: { success, message, version, traceId }. */
export const GhlFlowVersionResponseSchema = z
  .object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    version: GhlFlowVersionRawSchema,
    traceId: z.string().optional()
  })
  .passthrough()
export type GhlFlowVersionResponse = z.infer<typeof GhlFlowVersionResponseSchema>

/* ============================================================================
 * 4. NORMALIZED FlowGraph (Vue-Flow-shaped) — the canonical DAG our UI renders.
 *
 * This is the projection of GhlFlowVersionRaw that the three DAGs share
 * (Call Flow / Expected / Actual). The five `type`s collapse GHL's richer node
 * vocabulary (resolved off nodeType + frontendNodeType during normalization):
 *   triggerNode/start-action → 'trigger'
 *   llmNode/llm              → 'llm'
 *   router (universalNode/ai-router) → 'router'
 *   action (universalNode/actions)   → 'action'
 *   endCallNode              → 'endCall'
 * `position` comes from uiNodes; `data.prompt/tools/transitions` from nodeConfig.
 * ========================================================================== */

export const FlowNodeTypeSchema = z.enum(['trigger', 'llm', 'router', 'action', 'endCall'])
export type FlowNodeType = z.infer<typeof FlowNodeTypeSchema>

export const FlowPositionSchema = z.object({ x: z.number(), y: z.number() })
export type FlowPosition = z.infer<typeof FlowPositionSchema>

/** A natural-language branching transition declared on an llm/router node. */
export const FlowTransitionSchema = z.object({
  /** Target nodeId this transition leads to (when resolvable). */
  to: z.string().optional(),
  /** Human / NL condition (edge label or router intent), e.g. "Call router". */
  condition: z.string(),
  /** The tool the LLM must call to take this branch, if condition is tool-gated. */
  toolName: z.string().optional()
})
export type FlowTransition = z.infer<typeof FlowTransitionSchema>

export const FlowNodeDataSchema = z.object({
  displayName: z.string(),
  isStart: z.boolean().default(false),
  isEnd: z.boolean().default(false),
  /** LLM-node system prompt (from nodeConfig.prompt). */
  prompt: z.string().optional(),
  /** Tool ids/names attached to this node (from nodeConfig.tools). */
  tools: z.array(z.string()).optional(),
  /** Outgoing NL transitions (from edges + router intents). */
  transitions: z.array(FlowTransitionSchema).optional()
})
export type FlowNodeData = z.infer<typeof FlowNodeDataSchema>

/** Vue-Flow node: `{ id, type, position, data }`. */
export const FlowNodeSchema = z.object({
  id: z.string(), // = nodeId
  type: FlowNodeTypeSchema,
  position: FlowPositionSchema,
  data: FlowNodeDataSchema
})
export type FlowNode = z.infer<typeof FlowNodeSchema>

/** Vue-Flow edge: `{ id, source, target, label?, condition? }`. */
export const FlowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(), // source nodeId
  target: z.string(), // target nodeId
  label: z.string().optional(),
  /** Machine condition carried from the raw edge (e.g. tool_name EQ router). */
  condition: z.string().optional()
})
export type FlowEdge = z.infer<typeof FlowEdgeSchema>

/**
 * The normalized flow graph — same shape for Call Flow (as-designed),
 * Expected Flow (normative + per-call), and Actual Flow (as-ran) so all three
 * render through one `<FlowCanvas>`.
 */
export const FlowGraphSchema = z.object({
  versionId: z.string(),
  agentId: z.string(),
  isPublished: z.boolean().default(false),
  nodes: z.array(FlowNodeSchema),
  edges: z.array(FlowEdgeSchema),
  viewport: GhlViewportSchema.optional(),
  globalVariables: z.array(z.unknown()).default([])
})
export type FlowGraph = z.infer<typeof FlowGraphSchema>
