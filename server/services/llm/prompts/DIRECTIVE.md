# Prompts directory — directive

This directory is the single, versioned home for every LLM prompt in the app
(R2 requirement #3). Each prompt is one self-describing `PromptSpec<I,O>` module
(`successCriteria.ts`, `callAnalysis.ts`, …) registered in `registry.ts` as the
typed `PROMPTS` map. Nothing else in the codebase should hold prompt strings.

## The user directive this implements (verbatim intent, 2026-06-22)

> Everything needs to be **dynamic**. We cannot always ensure the closed-set
> [conversational] node will be deterministic or predefined — it always needs to
> be **inferred with a strong rule set and guardrails**. Maintain a very clear
> file with this prompt and **all prompts assembled in a single structured
> directory** in the project. **Judge every step that requires an LLM pass /
> analysis step which is currently hard-coded or not working as intended.** There
> are specific differences between **structured output, tool-calling, and other
> items** which all need to be handled. **Do not rely on hard-coded elements or
> placeholders. Everything must be functional end-to-end.**

## How a PromptSpec works

- `id` / `version` — stable key + bump-on-change version (persisted on each
  Analysis for honesty + diff-ability).
- `role: 'reasoner' | 'labeler'` — picks the model tier via `modelForRole`.
- `mode: 'json' | 'tool'` — provider transport for structured output.
- `inputSchema` / `outputSchema` — Zod contracts; the output schema is turned
  into a JSON Schema (`zodToJsonSchema`) for the provider, and every result is
  Zod-validated.
- `system(vars)` / `user(vars)` — prompt template builders.
- `guardrails[]` — post-validation invariants; a throw triggers repair-retry,
  then deterministic fallback (e.g. evidence-must-cite-a-real-entry).
- `fallback(vars)` — deterministic last resort (zero-cost, CI-stable).
- `maxTokens` — per-prompt output cap (cost control).

## Current registry

| id | role | what it emits | fallback |
|---|---|---|---|
| `successCriteria` | reasoner | bag of partial criteria (re-grounded downstream) | empty bag → spec-derived rubric |
| `callAnalysis` | reasoner | findings + recs + use-actions + scorecard, cited | transcript-grounded deterministic analysis |

Both were migrated **verbatim** out of `server/services/eval/{criteria,analysis}.ts`
in R2 Batch 1; their deterministic logic became the `fallback`, so the eval
pipeline behaves identically until it is rewired onto `generateStructured`.
