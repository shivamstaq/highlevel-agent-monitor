# Round-2 status — what changed since the r1 evidence pack

The app runs at http://localhost:3000 (dev). Harness at /_harness.html?w=<px>&path=<route>. Reviewers: verify against the LIVE app (curl SSR + read code + the maintainer's notes below). Read docs/punchlist-r2.md (the items + LOCKED LEXICON) and docs/design-spec.md.

## FIXED in round 2 (maintainer browser-verified — REGRESSION-CHECK these, don't re-report unless still broken)
- Lexicon unified: "Call score" (scorecard.overall), "Flow adherence" (conformanceScore), "Fleet health" (avg call score), "Criteria met" (true % met). "Script adherence" and "Overall score" removed. (P04, P09)
- Overview: fabricated "−46 vs. yesterday" delta REMOVED; Fleet health subtitle "Average call score across agents". (P02)
- Overview trend chart: was blank (Unovis hydration zero-width mount) → FIXED (client mount gate + resize nudge); teal line renders.
- Agents table: horizontal overflow FIXED (fixed layout + clamped goal); NEW "Flow adherence" column added → cross-agent comparison on the signature metric. (P03, P11, BF-02)
- Call detail: header now "Flow adherence" + "Call score" (with info tooltips); an always-visible compact Flow-adherence summary ("Walked 4 of 5 expected steps — skipped Greeting & Identification, Clarify Issue +1 more", "See full flow drift →") surfaces the differentiator out of the buried 4th tab. (P04, P12, P18)
- Agent detail: "Criteria met" donut now plots TRUE criteria-met % and renders a visible ring; "Expected call flow vs actual drift" fuses design-intent + drift. (P01, P19)
- Breadcrumbs: now correct in SSR on every page (route-derived trail floor + entity-name override). (P07)
- Outcomes humanized in the calls table/cells (humanizeOutcome). (P08) — NOTE: confirm the outcome FILTER dropdown options are humanized too (raw qualified_not_booked may still appear as a <select> value).
- Recommendations: RecommendationItem now carries callCount/agentCount; recurrence chip shown when >1. (P10)
- Timeline: scaled to real call duration (no more 46s-vs-258s); honest "Response latency · caller stops → agent speaks" label. (P05, P06)
- Settings: connection resolves to a clear state (not infinite spinner). (verify)
- Seed timestamps reanchored to "now" (newest call ~1h ago) so relative times + trend are truthful. (P02)

## SCRUTINIZE (remaining + regressions + the deeper bar)
- Run the MEDIUM/LOW items from docs/punchlist-r2.md that weren't listed above — verify each against the live app.
- Regressions from the fix round: check every page still renders (no blank charts/donuts, no overflow, no console errors) at 1280 and 390.
- Teaching/clarity: are "Flow adherence", "Use Actions", "Modeled timing" now DEFINED on first use? Is the expected-vs-actual story legible to a newcomer?
- The differentiators (expected flow / conformance drift / voice-pipeline timeline): now prominent enough? Coherent across Overview → Agent → Call?
- Evaluator bar: walk it as a skeptical HighLevel reviewer — what's the gap from "competent" to "exceptional" now? Single weakest screen?
- Brief coverage: cross-agent comparison now real (adherence column + recurrence)? Loop raw-logs→recommendation→act obvious end to end?
