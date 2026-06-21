# Rendered evidence pack — Wave 2 review round 1

The app runs at http://localhost:3000 (dev). A width-controllable iframe harness exists at `/_harness.html?w=<px>&path=<route>` for responsive checks (mirrors the production HighLevel Custom-Page iframe). The maintainer captured every screen at 1568px desktop + key screens at 390px mobile. This pack records what is ACTUALLY ON SCREEN so reviewers reason from rendered reality, not just code. Verify against the code (app/pages, app/components, app/layouts/default.vue, app/composables, app/assets/css/main.css) and go deeper per your lens.

## The brief (problem statement) — what this product must be
From FSB_assignment.pdf — "Voice AI Observability Copilot": automate the **Monitor** and **Analyze** phases for HighLevel Voice AI agents (a "Validation Flywheel").
- MONITOR: ingest & analyze existing Voice AI call transcripts; set observability parameters from each agent's goals/script; identify deviations, failures, missed opportunities vs success criteria (KPIs).
- ANALYZE: an intuitive dashboard visualizing performance issues across agents; immediate recommendations for prompt/script/agent adjustments; highlight "Use Actions" (specific call segments needing human intervention or script training).
- Integrate inside HighLevel (custom JS or marketplace app / Custom Page iframe).
- Deliverables: GitHub repo (Node backend + Vue frontend), README (architecture + "Team of One" + functional-vs-mocked), 2–5 min demo.
- Evaluation: **Product Thinking + UI/UX** (customer-centric, intuitive, seamlessly integrated into HighLevel), **Completeness** (closes the loop raw logs → actionable recommendations), **Technical Integrity** (clarity of observability architecture + recommendations logic), **non-slop code**.

## The expanded vision (the differentiators the maintainer added)
1. **Expected call flow** generated at agent creation (decision graph from goal/script) = the design-intent baseline.
2. **Flow conformance / drift** = process-mining alignment of the ACTUAL call path vs the expected flow (hit/skipped/out-of-order/extra, per-node drift, conformance score). Findings are grounded in concrete flow deviations.
3. **Voice-pipeline event timeline** (the signature) = LiveKit-style VAD→STT→EOU→LLM(TTFT)→TTS(TTFB)→audio Gantt with per-stage latency + barge-in markers. Timing is MODELED (HighLevel exposes none), labeled "Modeled timing"; a real ingestion path exists.
These must be PROMINENT, COHERENT, and TEACH the user what they mean — not just present.

## Current IA (after Wave 2)
Sidebar groups: Monitor (Overview /, Calls /calls, Recommendations /recommendations) · Agents (Agents /agents, New agent /agents/new) · Configure (Settings /settings). Topbar = sidebar trigger + breadcrumb. Tokens: single teal --primary, semantic status tokens (--success/-warning/-danger + soft), Inter + JetBrains Mono, SectionCard wrapper, useTone composable, CallTable shared component, useBreadcrumb composable.

## RENDERED OBSERVATIONS + confirmed defects (per screen)

### Global
- **Breadcrumb is broken on most pages.** Only `/settings` and `/agents/new` call `setBreadcrumb`; `/calls`, `/recommendations`, `/agents`, `/agents/[id]`, `/calls/[id]` all render just "Overview" in the topbar — wrong, and the app's only persistent wayfinding conveys nothing on those pages. (useBreadcrumb exists; pages don't all use it.)
- Brand mark teal + grouped nav + teal active state look good and native.

### / (Overview)
- 4 KPI cards: Fleet health **58 in red, "−46 vs. yesterday"** — the delta is fabricated noise (seed trend spans ~3 synthetic days; "vs yesterday" is misleading and alarming). Honesty/clarity defect. Fleet-health card also has a faint orphaned vertical line (a sparkline stub) at right that reads as a glitch.
- Failure rate 57% amber "Above 20% target"; Open use actions 12 amber "Awaiting review". Calls analyzed 7 "Across 4 agents". KPI anatomy is now uniform-ish but the health card's sparkline-vs-delta treatment is inconsistent with the others.
- Trend chart: single teal series, padded y — good. Title "Fleet health trend / Average call score per day".
- Agents preview table + "Top recommendations" feed with working deep-links (contact + agent chips). Good.

### /agents (Agents list)
- **DEFECT: the data table overflows horizontally.** Agent goal/description is NOT clamped (full long sentences), forcing the table wider than the viewport; a horizontal scrollbar appears and the intended metric columns (avg score, calls, failure rate, open use-actions, conformance) are pushed OFF-SCREEN to the right — invisible at 1568px. The list is effectively just name+goal. Major.
- Search + status filter present. 4 agents.

### /calls (Calls inbox)
- Clean CallTable: Contact, Agent, Outcome, Direction, Started (relative), Findings, Top severity (badge), Score (toned). Sortable headers. Good.
- **DEFECT: raw outcomes** shown as `qualified_not_booked`, `not_booked`, `qualified_booked` (snake_case, not humanized).
- Filters: All agents / Any severity / Any outcome. Lots of empty space below 7 rows (acceptable).
- Mobile (390): filters stack; table shows Contact+Agent then horizontal-scrolls — score/severity hidden behind scroll on phone.

### /recommendations (fix-queue)
- Grouped "High impact 12"; 3-col card grid; each card = target chip + Impact High + title + rationale + paste-ready code block + deep-links (contact + agent). Strong.
- **DEFECT: rec title casing inconsistent** — some Title Case ("Update Script to Correctly State Incentives"), some sentence case ("Ensure the agent acknowledges..."). LLM-generated; needs normalization.

### /settings
- HighLevel connection card shows **"Checking" forever** with skeleton Location ID / Signed-in user (standalone = no iframe context; never resolves to a clear "Not connected / open inside HighLevel" state).
- Analysis model card (Application + Scoring "Configured by your workspace") — vague; doesn't show the actual provider/model the code knows (ollama/qwen vs anthropic).
- Sync calls + Demo data cards — good. Breadcrumb works here.

### /agents/[id] (Agent detail)
- Header (avatar, name, goal, "View all calls", criteria chips). Stat strip (Avg score 55 red, Calls 2, Failure 50% red, Open use actions 3). Flow drift across calls (amber bars: Offer Retention 100% skipped, Greeting 50%, Clarify 50%; Avg adherence 60). Expected call flow diagram. Recommendations.
- **DEFECT: "Avg criteria met" donut renders BLANK** — the 55% number + criteria list show, but the donut ring/arc is invisible (white on white or not rendering). 
- Breadcrumb "Overview" (should be Agents / Aria).

### /calls/[id] (Call detail)
- Header: contact, agent, duration, Inbound, cancelled; **"Flow adherence 40" and "Script adherence 20"**. DEFECT: "Script adherence" is a RELABEL of the overall scorecard score — semantically wrong (overall weighted QA score ≠ script adherence) and confusing next to "Flow adherence". Re-run analysis button.
- Transcript: customer bubbles now neutral (good), Voice AI bubbles get amber evidence rings; "USE ACTION SEGMENT" still tags MANY turns (over-labeled, dilutes meaning). Scorecard with teal progress + per-criterion dots. Tabs Findings/Recommendations/Use Actions/Flow drift. Finding "Cites turn #1 →".
- Voice Pipeline Timeline (full-width below, from earlier rounds): 7 lanes, latency bars, barge-in ticks, "Modeled timing" badge — the signature.
- Breadcrumb "Overview" (should be Calls / Sandra Mills).

### Responsive (390px harness)
- Overview KPIs stack cleanly; sidebar collapses to trigger. Good.
- Calls table horizontal-scrolls on phone (data-table reflow not phone-optimized).

## Known-suspect areas to scrutinize (go beyond the above)
- Does the product ever EXPLAIN flow conformance / "Modeled timing" / "Use Actions" to a first-time user, or assume prior knowledge? (thought clarity)
- Is the loop "raw logs → recommendation → act" navigable end-to-end and obvious? Where does a HighLevel customer get lost?
- Consistency of the score vocabulary across screens (Fleet health / Avg score / Flow adherence / Script adherence / conformance / fitness / adherence) — too many synonyms?
- Empty/error/loading states on the NEW pages (calls/agents/recs/settings) — present and helpful?
- Is anything from the BRIEF missing or buried (e.g., the "Analyze dashboard visualizes performance issues across agents" — is cross-agent comparison strong)?
