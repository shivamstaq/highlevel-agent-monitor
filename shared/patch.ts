/**
 * CREATED — write-back flywheel apply engine.
 *
 * Deterministically applies a `TextPatch` (anchored ops or full rewrite) to a
 * current text, with no LLM call. Shared by:
 *  - the `callAnalysis` guardrail (validate a model-emitted patch is applicable
 *    AT ANALYSIS TIME, while the current text is in context), and
 *  - the apply route (re-validate against fresh text, then apply).
 *
 * Anchor semantics: an `anchor` must occur EXACTLY ONCE in the current text
 * (verbatim). This makes apply unambiguous and lets us fail loud (→ manual
 * `suggestedChange`) rather than guess when the model paraphrased or the agent
 * drifted underneath us.
 */
import type { TextPatch, PromptEditOp } from './types'

export interface PatchOk { ok: true, result: string }
export interface PatchErr { ok: false, error: string }
export type PatchResult = PatchOk | PatchErr

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0, i = 0
  for (;;) {
    const idx = haystack.indexOf(needle, i)
    if (idx === -1) break
    n++
    i = idx + needle.length
  }
  return n
}

/** Validate a patch against `current`; returns [] when applicable, else reasons. */
export function validateTextPatch(current: string, patch: TextPatch): string[] {
  if (patch.mode === 'rewrite') {
    return patch.fullText.trim().length === 0 ? ['rewrite.fullText is empty'] : []
  }
  const errors: string[] = []
  // Anchored ops must each match the ORIGINAL text exactly once, and ranges must
  // not overlap (so order-independent, composable application is well-defined).
  const ranges: Array<[number, number]> = []
  for (const [i, op] of patch.ops.entries()) {
    if (op.op === 'append') continue
    const c = countOccurrences(current, op.anchor)
    if (c === 0) {
      errors.push(`op[${i}] ${op.op}: anchor not found: ${JSON.stringify(op.anchor.slice(0, 60))}`)
      continue
    }
    if (c > 1) {
      errors.push(`op[${i}] ${op.op}: anchor not unique (${c}×): ${JSON.stringify(op.anchor.slice(0, 60))}`)
      continue
    }
    const start = current.indexOf(op.anchor)
    ranges.push([start, start + op.anchor.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]![0] < ranges[i - 1]![1]) {
      errors.push('overlapping anchors')
      break
    }
  }
  return errors
}

/** Apply a patch to `current`. Validates first; never partially applies. */
export function applyTextPatch(current: string, patch: TextPatch): PatchResult {
  const errors = validateTextPatch(current, patch)
  if (errors.length) return { ok: false, error: errors.join('; ') }
  if (patch.mode === 'rewrite') return { ok: true, result: patch.fullText }

  // Compute all edits against the ORIGINAL string, then splice right-to-left so
  // earlier offsets stay valid regardless of length deltas.
  type Edit = { start: number, end: number, insert: string }
  const edits: Edit[] = []
  const appends: string[] = []
  for (const op of patch.ops as PromptEditOp[]) {
    if (op.op === 'append') {
      appends.push(op.text)
      continue
    }
    const start = current.indexOf(op.anchor)
    const end = start + op.anchor.length
    if (op.op === 'replace') edits.push({ start, end, insert: op.replacement })
    else if (op.op === 'insertAfter') edits.push({ start: end, end, insert: op.text })
    else /* insertBefore */ edits.push({ start, end: start, insert: op.text })
  }
  edits.sort((a, b) => b.start - a.start)
  let result = current
  for (const e of edits) result = result.slice(0, e.start) + e.insert + result.slice(e.end)
  for (const a of appends) result = result + a
  return { ok: true, result }
}
