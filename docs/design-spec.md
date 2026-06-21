# Voice AI Copilot — Wave 2 Design Spec (authoritative)

Owner-confirmed decisions (do NOT relitigate):

- **Visual identity:** Refined GHL-native.
- **Accent:** GHL-native **teal** (#14B8A6 family) as the single `--primary`.
- **IA:** Full operator IA. Sidebar groups: **Monitor** (Overview, Calls, Recommendations) · **Agents** (Agents list + New agent) · **Configure** (Settings).
- **Triage:** Build BOTH `/calls` (inbox) AND `/recommendations` (fleet-wide fix-queue, deep-linking to source call/agent).
- **Density:** Comfortable operator density, **no user toggle**. Fixed ~48px table rows.
- **Terminology:** KEEP "Use Actions" (assignment's own term) — do NOT rename to 'Action items' (override analyst W14).

## Density rules

COMFORTABLE-DEFAULT OPERATOR DENSITY, no user-facing toggle (match GHL exactly). Concrete rules: (1) LIST DENSITY — object lists (Agents list, Calls inbox, 'Calls needing attention', 'Top recommendations' as table-where-homogeneous) are real shadcn data tables with ~48px comfortable row height (Carbon 'lg'), full-row click-through + ChevronRight, sortable headers with aria-sort. Reuse a single shared CallTable/CallRow + the existing AgentTable pattern so all call surfaces share columns and score formatting. Target 25-50 rows/view with pagination; no card walls for homogeneous records. (2) DETAIL DENSITY — card padding 16px (dense lists/headers) to 20px (roomy content cards), section gap 24px. (3) TYPE SCALE (locked, applied by role, sentence-case): Display/page-H1 24px/600, Title/section+card 18px/600, Body 14px/400, Body-strong 14px/600, Label 12px/500, Micro/eyebrow 11px/500 uppercase tracking-wide (used sparingly), Metric 30px/600 tabular (KPIs+headline scores), Metric-sm 24px/600 (secondary stats). Kill all text-[10px]; nothing below 11px, and 11px only for eyebrows. (4) SPACING UNIT — 4px base (Tailwind default), 8px rhythm for card header padding (py-4), section gap 24px (gap-6). Cards reserved strictly for heterogeneous content (recommendation = title+rationale+code; finding) and the 4-up KPI summary; everything comparable is a table.

## Design system tokens

REFINED GHL-NATIVE TOKEN SPEC (all tokens added to app/assets/css/main.css :root + .dark; charts/components consume tokens only — no raw Tailwind palette utilities).

ACCENT (the ONE restrained accent): --primary -> oklch(0.62 0.13 192) (GHL-native teal, ~#14B8A6 family); --primary-foreground -> oklch(0.985 0 0); --ring -> oklch(0.62 0.13 192 / 0.5). Accent reserved STRICTLY for: active nav, primary buttons, links, focus ring, the single chart series, selection/active-highlight. STOP overloading --primary as the transcript customer-bubble fill — render that bubble with --secondary (filled neutral) instead. Reconcile dark mode: dark --primary must keep the SAME teal identity (not oklch 0.922 near-white); remove the blue --sidebar-primary/--chart-1 (oklch 0.488 0.243 264) drift so the accent is consistent light+dark.

STATUS TOKENS (three semantic pairs; route ALL status color through these — replace every literal emerald-/amber-/red-/sky-/violet-NNN across the 9 components): --success / --success-soft (emerald ~oklch 0.62 0.15 155), --warning / --warning-soft (amber ~oklch 0.75 0.15 75), --danger / --danger-soft (align with --destructive). base = dot/bar-fill/foreground; -soft = ~12% chroma-matched badge/bar-track background. One scoreTone()/severity map in a composable returns token classes used everywhere (KpiCard deltas, AgentTable bars/badges, SeverityBadge, FindingCard, FlowDiagram status dots, CallTimeline latency tone, FlowDrift).

CHART TOKENS: delete the rainbow --chart-1..5; replace with accent-derived ramp: --chart-1: var(--primary) (single trend series + donut value), --chart-track (donut/bar remainder = --muted), --chart-grid. Thresholds use the status tokens. One series = one accent; never the rainbow. Fix HealthChart y-domain from hard [0,100] to padded auto ([min-10,100]) so a 55-65 series fills the plot.

SPACING UNIT: 4px base; section gap 24px (gap-6); card header py-4 (8pt); content p-5 roomy / p-4 dense — chosen per density tier, not per file.

TYPE SCALE: see densityDecision (24/18/14/14-strong/12/11/30/24-metric ladder, sentence case). Load a real font (no font is loaded today): adopt Inter for sans (recommended over Geist for max GHL-native familiarity) + JetBrains Mono / Geist Mono for code blocks and turn-index labels; set --font-sans/--font-mono tokens, wire into @theme inline (--font-family-sans), and set body font-feature-settings: 'tnum' 1, 'cv01' 1 so the heavy tabular-nums usage actually aligns.

RADIUS: drive everything from --radius (0.625rem): cards/containers rounded-xl (lg), controls/badges/chips rounded-md, pills/avatars rounded-full. Retire rounded-2xl and rounded-[3px]. Bake the card pattern into a <SectionCard> wrapper (header slot at py-4 border-b + body slot) so per-instance gap-0/py-0 + 3-different-header-padding drift (py-4/py-3.5/py-3) can't recur.

ELEVATION: 2-step token scale --elevation-1 (resting card) / --elevation-2 (hover/popover). Resting cards = elevation-1; interactive cards lift to elevation-2 on hover. No more bare shadow-md.

THE ONE SIGNATURE ELEMENT: the Voice Pipeline Timeline (CallTimeline). Own it as 'Voice Pipeline Timeline' (single header — remove the duplicate page wrapper). Discipline its 7-hue rainbow lanes into a restrained sequential ramp: low-chroma neutral/teal-tinted lanes for non-cost stages (caller/STT/VAD/agent), and reserve saturated + warning/danger tones strictly for the COST lanes (EOU/LLM/TTS) and interruptions, so color encodes 'where latency is spent,' not decoration. Keep the 'Modeled timing' honesty popover (credibility asset). The transcript cross-highlight is the SUPPORTING signature: two-token highlight language — evidence = --warning ring, use-action segment = a dedicated --segment left-band, active = accent ring.

MOTION: one easing curve (e.g. cubic-bezier(0.2,0,0,1)) + one duration (~150-200ms) as tokens. Replace scale-[1.01] transcript jiggle with a gentle bg-tint fade. Gate all scale/translate/scroll-smooth behind motion-safe: / @media (prefers-reduced-motion: reduce); keep motion-free color/ring highlights always on.

## Page inventory (Full operator IA)

- **/** — Overview (dashboard) (needs_rework): At-a-glance fleet dashboard: 4 uniform KPI cards (health, calls analyzed, failure rate, open action items), a compact trend strip, a bounded top-N agents preview linking to /agents, and a bounded top-N recommendations preview where each item deep-links to its source call/agent. Demo-data controls move OUT to /settings.  
  _Reached:_ Sidebar > Monitor > Overview; app landing route.
- **/agents** — Agents list (needs_build): Full-width roster data table (search + status filter, sortable score/failure/action columns, full-row drill-down) reusing AgentTable. Header action '+ New agent'. The destination representing 'the agents I manage'.  
  _Reached:_ Sidebar > Agents > Agents; and 'View all agents' from the Overview agents preview.
- **/agents/[id]** — Agent detail (needs_rework): Per-agent drill-down: header card, stat strip, flow-drift rollup, 'Calls needing attention' (shared CallTable), Expected call flow (FlowDiagram — moved to the WIDE column for room), Criteria-met donut, Recommendations. Adds 'View all calls for this agent' link to /calls?agentId=.  
  _Reached:_ From /agents row, Overview agents preview, breadcrumb, recommendation deep-links.
- **/agents/new** — New agent (needs_rework): Create an agent (name, goal, script) -> server derives criteria + expected flow. Pre-creation collapses to a centered single form column; flow panel reveals after create. Verb spine: 'Create agent' / 'Creating...' / 'Open agent'.  
  _Reached:_ Sidebar Agents secondary action '+ New agent'; '+ New agent' header action on /agents.
- **/calls** — Calls inbox (needs_build): Global filterable call list rendering GET /api/calls (contact, agent, outcome, direction, started, findingCount, top severity, score) with URL-synced agentId/severity/outcome filters, full-row link to /calls/[id]. Home for the 'Sync calls from HighLevel' trigger. THE QA operator's daily triage queue.  
  _Reached:_ Sidebar > Monitor > Calls; deep-linked from agent detail ('View all calls' -> /calls?agentId=); recommendation deep-links.
- **/calls/[id]** — Call detail (needs_rework): Transcript (with two-way cross-highlight) + scorecard/tabs (Findings/Recommendations/Action items/Flow drift) + the signature Voice Pipeline Timeline (single card, no duplicate header). Agent name becomes a link; adds 'View all calls' + prev/next; proper error vs not-found branching; re-analyze shows a re-scoring state.  
  _Reached:_ From /calls row, agent 'Calls needing attention', recommendation deep-links, breadcrumb.
- **/settings** — Settings & integrations (needs_build): GHL connection status + resolved location/user (invoke useGhlBridge), LLM provider/model, manual 'Sync calls from HighLevel' (/api/sync), demo-data controls (moved from Overview). For an embedded marketplace app, 'which location am I scoped to / am I connected / which model scores my calls' table-stakes info.  
  _Reached:_ Sidebar footer (pinned) > Settings.
- **/error (app/error.vue)** — Error / 404 boundary (needs_build): Neutral GHL-native error page distinguishing 404 vs 500, with a primary 'Back to Overview' action, so a bad route or API 500 doesn't fall through to Nuxt's unstyled default inside the iframe.  
  _Reached:_ Any unmatched route or unhandled server error.
- **/recommendations** — Recommendations fix-queue (needs_build): fleet-wide worklist of every open recommendation, deep-linking to its source call/agent.  
  _Reached:_ sidebar Monitor → /recommendations.

## Prioritized work items

### CRITICAL (3)

- **W01 — Introduce the single teal accent + status/chart tokens** _( global / main.css )_  
  Set --primary to oklch(0.62 0.13 192) (GHL teal) + matching --primary-foreground/--ring; add --success/-soft, --warning/-soft, --danger/-soft pairs; delete rainbow --chart-1..5 and replace with --chart-1=var(--primary), --chart-track, --chart-grid. Reconcile dark-mode accent to the SAME teal (drop near-white --primary and blue --sidebar-primary/--chart-1 drift). Wire all into @theme inline.
- **W02 — Build the Calls inbox (/calls)** _( Calls )_  
  Add /calls page rendering getCalls() in a shared CallTable (contact, agent, outcome, direction, started, findingCount, top severity, score) with URL-synced agentId/severity/outcome filters and full-row link to /calls/[id]. This is the only path to passing/un-analyzed calls today. Add useApi.getCalls already exists; add a sync() wrapper for /api/sync.
- **W03 — Add error handling to all data fetches + app/error.vue** _( global )_  
  Destructure `error` from every useAsyncData (index, agents/[id], calls/[id]); add a distinct error branch BEFORE the not-found fallback (Alert + cause hint + 'Try again' calling refresh()), differentiating true 404 (data resolved, entity missing) from transport error. Add app/error.vue (neutral styled, 404 vs 500, 'Back to Overview').

### HIGH (12)

- **W04 — Route all status color through semantic tokens** _( global / KpiCard, AgentTable, SeverityBadge, FindingCard, CallTimeline, FlowDiagram, FlowDrift, calls/[id], agents/[id] )_  
  Replace every hand-typed emerald-/amber-/red-/sky-/violet-NNN utility with the --success/--warning/--danger token pairs via one shared scoreTone()/severity composable. Eliminates the inconsistent-shade spray across 9 files.
- **W05 — Load a real typeface + lock the type-scale roles** _( global / nuxt.config, main.css )_  
  Load Inter (sans) + JetBrains/Geist Mono (code/turn labels) via @fontsource or font link; set --font-sans/--font-mono tokens, wire @theme inline, add body font-feature-settings 'tnum'/'cv01'. Apply the locked 24/18/14/14-strong/12/11/30/24 role scale by role across all pages; normalize H1 (Agent detail text-xl -> 24px); remove all text-[10px] and arbitrary text-[11px].
- **W06 — Build the Agents list page (/agents) + restructure sidebar nav** _( Agents / global nav )_  
  Promote the roster to /agents (full-width AgentTable + search/status filter). Restructure sidebar into grouped nav — Monitor: Overview, Calls; Agents: Agents (with '+ New agent' as secondary action, not a top-level peer); pin Settings to the footer. Replace the static marketing footer with resolved location/connection status.
- **W07 — Build Settings & integrations (/settings) + invoke useGhlBridge + wire /api/sync** _( Settings )_  
  Add /settings showing GHL connection status + resolved locationId/user (invoke useGhlBridge in layout — currently dead code), LLM provider/model, a 'Sync calls from HighLevel' button wired to /api/sync, and the demo-data controls moved off the Overview header.
- **W08 — Discipline the Voice Pipeline Timeline + remove its duplicate card/header** _( Call detail / CallTimeline (signature) )_  
  Delete the outer Card+title wrapper in calls/[id].vue and let CallTimeline render standalone (one header, 'Voice Pipeline Timeline'). Replace the 7-hue rainbow lanes with a restrained sequential ramp where saturated/warning/danger tones are reserved for the cost lanes (EOU/LLM/TTS) + interruptions. Keep the 'Modeled timing' honesty popover.
- **W09 — Make recommendations deep-link to their source** _( Overview / Agent detail / Call detail )_  
  Surface agentId/callId on the Recommendation payload (Analysis already carries them) and add a NuxtLink 'View call/agent' affordance to RecommendationCard so the Overview 'Top recommendations' feed and agent recommendations stop being dead leaves. Closes the surface-fix -> act loop.
- **W10 — Make AgentTable rows + sort headers keyboard-accessible** _( AgentTable )_  
  Wrap row content in NuxtLink (or add tabindex=0/role=link/Enter+Space handler + focus-visible ring) so the roster is keyboard-reachable. On sort headers add aria-sort, swap ArrowDownUp for directional ArrowUp/Down on the active column, tint active, add focus-visible ring.
- **W11 — Give FlowDiagram room + fix label/branch truncation** _( Agent detail / FlowDiagram )_  
  Move 'Expected call flow' to the WIDE left column (it needs ~520-600px). Allow 2-line line-clamp-2 node titles instead of hard one-line truncation; make branch-card width responsive so spine+branch never exceed 100%; clamp/tooltip the conditional edge-condition pills so they stop overlapping.
- **W12 — Re-analyze pending/re-scoring state** _( Call detail )_  
  While reanalyzing, dim/overlay the scorecard+tabs+timeline with a 'Re-scoring this call...' state (keep transcript readable); on completion briefly flash changed score numbers. Use toast.promise for the analyze round-trip.
- **W13 — Standardize KPI card anatomy** _( Overview / KpiCard )_  
  Give all four KPI cards one anatomy: label + metric + a delta line for ALL (reserve the delta row height even when 'within target' so baselines align), and show a sparkline on all trend-bearing KPIs or none. Replace the four colored icon chips with one neutral chip; apply accent/danger ONLY when a metric is in a warning/critical band. Remove hardcoded trend='up'. Add a per-card skeleton matching the loaded layout.
- **W14 — Rename 'use-actions' to 'Action items' app-wide** _( global microcopy )_  
  One-pass rename: KPI 'Open Use-Actions' -> 'Open action items', AgentTable column 'Use-actions' -> 'Actions', tab 'Use-actions' -> 'Action items', empty states reworded. (Confirm with product owner whether 'use-action' carries external marketplace meaning before the global rename — see openForks.)
- **W15 — Rewrite error toasts + form validation for recovery** _( Overview / New agent / Call detail )_  
  Rewrite error toasts to 'what happened + how to fix' with a Retry action (use toast.promise for seed/analyze/create). Move New-agent 'Name and goal are required' out of a toast into inline field errors (aria-invalid, red border, helper) and disable 'Create agent' until name+goal are non-empty.

### MEDIUM (16)

- **W16 — Real interactive breadcrumb fed by entity data** _( global topbar )_  
  Replace the static span breadcrumb with the installed ui/breadcrumb components, fed per-page (useBreadcrumb/definePageMeta), clickable ancestors + resolved entity-name leaf (e.g. Agents / Solar Lead Qualifier / Jane Doe). Add per-page useHead titles.
- **W17 — Fix Overview/Agent-detail column-height inversion** _( Overview / Agent detail )_  
  Bound both Overview lists to similar item counts (top-N agents preview + 'View all', top-3/4 recommendations + 'See all') so columns terminate near the same baseline and the wide column isn't a dead L-shape. On agent detail, the FlowDiagram move (W11) fills the previously hollow wide column.
- **W18 — Standardize card pattern + radius + elevation via SectionCard** _( global / Card + all card consumers )_  
  Introduce a <SectionCard> (header slot py-4 border-b + body slot) to stop the gap-0/py-0 + three-header-padding drift. Commit to one radius family (cards rounded-xl, controls rounded-md, pills rounded-full; retire rounded-2xl/[3px]) and a 2-step elevation token scale applied uniformly.
- **W19 — Two-way transcript<->timeline<->flow cross-highlight** _( Call detail )_  
  Hold a shared activeTurnIdx on the page; pass it to CallTimeline (:active-turn-idx already supported) and FlowDiagram (:active-node-id already supported), make transcript turns clickable to set it, and keep clicked timeline/flow elements in a persisted selected state. Closes the one-directional highlight loop.
- **W20 — Standardize content max-width across pages** _( global )_  
  Apply one container rule via the layout <main>: dense pages = max-w-[1400px] (replace the 7xl/1400px/5xl mix), form-centric pages (New agent) intentionally narrower (~max-w-3xl/4xl, centered). Stops the left-edge 'jump' when navigating Overview -> Call -> New agent.
- **W21 — Add md breakpoint tier for tablet reflow** _( global )_  
  Insert an md (768px) tier between 1-col and the lg desktop grids so tablet portrait gets 2 columns where they fit (call panes, new-agent form/flow) instead of jumping straight from single-column to full desktop grids. Verify at ~800px.
- **W22 — Make FlowDiagram non-interactive where it has no handler (or give it purpose)** _( Agent detail / FlowDiagram )_  
  On agents/[id] the nodes render as <button>s with hover/focus but no @node-click handler (dead affordance). Either render a non-interactive div when no handler is bound, or wire node-click to filter 'Calls needing attention' to calls that skipped/drifted that node.
- **W23 — Make timeline SVG segments + modeled badge keyboard accessible** _( CallTimeline )_  
  Add tabindex=0/role=button/aria-label + focus-visible outline to interactive timeline segments and barge-in ticks (trigger selectTurn on Enter/Space, open tooltip on focus). Replace focus:outline-none on the 'Modeled timing' popover trigger with a focus-visible ring; surface the 'click a bar to highlight the cited turn' hint as static caption text.
- **W24 — Honor prefers-reduced-motion across animations** _( global / TranscriptViewer, CallTimeline, FindingCard, buttons )_  
  Gate scale/translate/scroll-smooth/spin/pulse behind motion-safe: or @media (prefers-reduced-motion: reduce). Replace the transcript scale-[1.01] flash with a bg-tint fade. Keep motion-free color/ring highlights always on.
- **W25 — Tighten the trend chart (size + y-domain)** _( Overview / HealthChart )_  
  Shrink the ~320px trend card to ~160-200px and replace the hard y-domain [0,100] with a padded auto domain ([min-10,100]) so a 55-65 series fills the plot instead of hugging the floor, freeing above-the-fold space for the agents content.
- **W26 — Sentence-case audit across all headings/labels** _( global microcopy )_  
  Convert Title Case violations to sentence case in one pass: 'Fleet Overview' -> 'Overview', 'Calls Analyzed' -> 'Calls analyzed', 'Failure Rate' -> 'Failure rate', 'Fleet Health' -> 'Agent health', 'New Voice AI agent' -> 'New agent'. Audit every CardTitle/Label/KpiCard label.
- **W27 — Standardize create/analyze verb spine + loading labels** _( New agent / Call detail microcopy )_  
  New agent: primary button 'Create agent' (loading 'Creating...'), drop '& design flow'; keep 'Open agent'/'Create another'. Call detail: idle 'Re-run analysis' (analyzed) / 'Analyze call' (never), loading 'Analyzing...', success 'Analysis updated', error 'Couldn't re-run analysis - try again.' Name loading labels ('Loading demo data...').
- **W28 — Make empty states invitations, not dead ends** _( Agent detail / Call detail tabs / Overview recommendations )_  
  Reword empty states to invite action and drop jargon ('playbook' -> 'expected flow'); add inline actions/links (recommendations-empty -> analyze action; 'No failing calls' -> 'View all calls' link). Reuse the strong Overview empty-state pattern (icon + heading + sub + button).
- **W29 — Fix transcript nested-scroll mismatch** _( Call detail / TranscriptViewer )_  
  Resolve the h-[calc(100svh-13rem)] inner ScrollArea vs page-scroll mismatch (the magic 13rem breaks when the header wraps): either drop the inner ScrollArea and let both columns share page scroll, or make it a deliberate two-pane split where both columns are independently sticky/scrollable to a measured offset.
- **W30 — Plain-language jargon pass: conformance/drift/fleet/pipeline acronyms** _( Agent detail / Call detail / New agent )_  
  Replace 'conformance'/'Avg conformance' with 'adherence'/'Avg adherence' (or add a first-use tooltip); reword the call-header score to 'Script adherence'; cut overwrought New-agent/timeline filler and raw VAD/STT/TTS acronyms from prose (keep acronyms only inside lane labels with tooltips).
- **W31 — Cross-links: call header agent name + 'View all calls'** _( Call detail )_  
  Make the agent name in the call header a NuxtLink to /agents/[id]; add a 'View all calls' link to /calls?agentId=<id>; add prev/next call navigation seeded from the originating list.

### LOW (7)

- **W32 — Move transcript customer bubble off the accent token** _( Call detail / TranscriptViewer )_  
  Render the customer chat bubble with --secondary (filled neutral) instead of bg-primary so the new teal accent doesn't carpet half the transcript; reserve the accent for genuine emphasis/active state.
- **W33 — Demote FlowDiagram kind-color rainbow** _( Agent detail / Call detail / FlowDiagram )_  
  Render node KIND via icon + label in a single neutral chip (retire the 8 saturated KIND_META hues) and reserve color on the diagram for conformance status (hit/skip/drift = success/danger/warning tokens), so it stops carrying two competing color systems and lets the timeline be the color hero.
- **W34 — Constrain not-found/empty cards to a centered block** _( global )_  
  Constrain 'Agent not found'/'Call not found'/'Not analyzed yet' states to a centered max-w-md block with an icon (mirror the good Overview 'No agents yet' pattern) instead of stretching edge-to-edge at full page width.
- **W35 — Recommendation copy-failure feedback** _( RecommendationCard )_  
  On clipboard.writeText failure (plausible inside the GHL iframe / non-secure context) toast.error('Couldn't copy - select and copy manually') or fall back to selecting the <pre>; add aria-live so the 'Copied' state is announced.
- **W36 — Stabilize call-detail tab strip + zero-count tabs** _( Call detail )_  
  Always render the Flow-drift tab slot (show 'No flow baseline' when absent) so the tab row doesn't reflow per call; mute zero-count badges and give every empty tab the Findings-tab icon+message treatment.
- **W37 — Wire dark-mode toggle (or fix dark tokens to match teal)** _( global / topbar )_  
  Tokens + dark: variants exist but nothing toggles .dark. Add @nuxtjs/color-mode + a topbar toggle, OR if out of scope, at minimum fix the dark accent tokens (W01) so the system is internally consistent when shipped.
- **W38 — New-agent pre-creation layout + flow-drift bar readability** _( New agent / Agent detail )_  
  Pre-creation, collapse New agent to a centered single form column (reveal the flow panel after create; reduce placeholder py-20 -> py-12). On the flow-drift rollup, use a 3-col (label / taller h-2 bar with visible track / right-aligned %) grid so partial fills read as meters, not stray underlines.
