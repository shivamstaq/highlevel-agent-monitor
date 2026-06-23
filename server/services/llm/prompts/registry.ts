/**
 * Typed prompt registry (R2 / ADR §1.3).
 *
 * `PROMPTS` is the single source of truth for every LLM prompt. It is `as const`
 * so that `PromptId`, the per-prompt input vars (`PromptVars<Id>`) and output
 * (`PromptOutput<Id>`) are all type-safe at every call site — `generateStructured`
 * keys off this map and infers the exact I/O for the resolved spec.
 *
 * Add a new prompt by defining its `PromptSpec` module and registering it here.
 */
import type { z } from 'zod'
import type { PromptSpec } from './types'
import { successCriteriaPrompt } from './successCriteria'
import { callAnalysisPrompt } from './callAnalysis'
import { stageInferencePrompt } from './stageInference'
import { turnLabelingPrompt } from './turnLabeling'
import { checkpointDriftPrompt } from './checkpointDrift'
import { inferredFlowPrompt } from './inferredFlow'
import { flowAlignmentPrompt } from './flowAlignment'

export const PROMPTS = {
  successCriteria: successCriteriaPrompt,
  callAnalysis: callAnalysisPrompt,
  stageInference: stageInferencePrompt,
  turnLabeling: turnLabelingPrompt,
  checkpointDrift: checkpointDriftPrompt,
  inferredFlow: inferredFlowPrompt,
  flowAlignment: flowAlignmentPrompt
} as const

export type PromptId = keyof typeof PROMPTS

/**
 * Input vars type for a given prompt id (inferred from its inputSchema).
 *
 * Both I and O are inferred together: `PromptSpec` is invariant in its output
 * param (it carries a `z.ZodType<O>`, invariant in O), so matching against a fixed
 * `unknown` for the un-wanted param would fail the `extends` check and collapse to
 * `never`. Inferring both lets the concrete spec type match and recover the param.
 */
export type PromptVars<Id extends PromptId>
  = (typeof PROMPTS)[Id] extends PromptSpec<infer I, infer _O> ? I : never

/** Output type for a given prompt id (inferred from its outputSchema). */
export type PromptOutput<Id extends PromptId>
  = (typeof PROMPTS)[Id] extends PromptSpec<infer _I, infer O> ? O : never

/** Narrowed accessor — returns the concrete spec for an id. */
export function getPrompt<Id extends PromptId>(id: Id): (typeof PROMPTS)[Id] {
  return PROMPTS[id]
}

// `z` is re-exported for downstream spec modules that build per-call schemas.
export type { z }
