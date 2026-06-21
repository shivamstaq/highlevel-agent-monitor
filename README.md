# Voice AI Observability Copilot

A **Validation Flywheel for HighLevel Voice AI**: it ingests your GoHighLevel Voice AI call logs and transcripts, scores each conversation against the agent's *own* goal and script, and turns raw transcripts into ranked, paste-ready fixes — automating the **Monitor** and **Analyze** halves of the agent-improvement loop so an operator running a fleet of voice agents always knows which agent is drifting, why, and exactly what to change. It embeds directly inside HighLevel as a Custom Page iframe, so the whole loop lives where the customer already works.

What makes it more than a transcript scorer — two layers that model how voice agents *actually* run:

- **Expected call flow (design intent).** At agent-creation the Copilot compiles the agent's goal + script into a **decision graph** (greeting → qualify → collect → confirm → handle-objection → close, with branches) — *before the agent ever takes a call*. This is the observability baseline.
- **Flow conformance / drift.** Every call is treated as an execution trace and aligned against that expected flow (process-mining conformance): which designed steps were **hit / skipped / out-of-order**, a per-node drift score, and an overall conformance score. Findings stop being generic ("be more empathetic") and become concrete ("skipped the call-back read-back at turns 6–7").
- **Realtime voice-pipeline timeline.** A per-call event timeline that renders the LiveKit-style pipeline — VAD → STT → end-of-utterance → LLM (TTFT) → TTS (TTFB) → audio out — as a Gantt with per-stage latency bars and barge-in markers, so the operator sees *how* the call ran, not just *what* was said.

---

## Architecture

```
                      HighLevel Voice AI (sandbox sub-account)
                                   │
              ┌────────────────────┴─────────────────────┐
              │ real-time                       on-demand │
        webhook push                            PIT poll  │
   POST /api/webhooks/ghl              POST /api/sync ────┘
   (call-completed /                  (GET /voice-ai/dashboard/call-logs
    transcript-generated)              via Private Integration Token)
              │                                  │
              └──────────────┬───────────────────┘
                             ▼
                     Ingestion (server/services/ghl.ts)
                 GHL call-log ─► Call + Transcript (zod-validated)
                             │
                             ▼
        ┌────────────────────────────────────────────────┐
        │   Pluggable LLM analysis engine                 │
        │   server/services/llm + analysis.ts             │
        │                                                 │
        │   LLMProvider.complete<T>({ system, user,       │
        │                             schema, schemaName })│
        │     • Ollama   (default — /api/chat, JSON schema)│
        │     • Anthropic(drop-in — claude-opus-4-8)      │
        │     • mock     (deterministic, no model)        │
        │                                                 │
        │   Output ─► AnalysisResultSchema (zod-validated)│
        │   findings · scorecard · recommendations ·      │
        │   useActions, every claim cited by turn index   │
        └────────────────────────────────────────────────┘
                             │
                             ▼
                 Storage (Nitro useStorage('data'), fs driver)
            agents: · calls: · transcripts: · analyses:
                             │
                             ▼
                   Nitro API (server/api/*)
        /api/agents · /api/agents/:id · /api/agents/:id/flow ·
        /api/calls · /api/calls/:id · /api/analyze/:callId · /api/context
                             │
                             ▼
            shadcn-vue dashboard (Vue 3 <script setup>)
       Fleet KPIs · trend chart · agent table · call drill-down
                             │
                             ▼
        Embedded as a HighLevel Custom Page <iframe>
   (?locationId={{location.id}} · postMessage bridge · signed-context decode)
```

**Stack:** [Nuxt 4](https://nuxt.com) — a **Nitro** backend (server routes = Node.js API)
plus a **Vue 3** frontend in one repo. UI is built on **shadcn-vue**
(`app/components/ui/*`) with **@unovis/vue** charts and `lucide-vue-next` icons.
The entire domain — LLM output, API responses, and UI props — is described by a
single set of **zod** schemas in `shared/types.ts`, so the model's structured
output, the API contract, and the components stay in lock-step.

### Service layering

| Layer | Location | Responsibility |
| --- | --- | --- |
| Domain contract | `shared/types.ts` | zod schemas + inferred types, single source of truth |
| Storage | `server/services/db.ts` | typed helpers over `useStorage('data')` |
| Ingestion | `server/services/ghl.ts` | PIT client, GHL call-log → `Call`+`Transcript` |
| Analysis engine | `server/services/{llm,analysis,criteria}.ts` | prompt build, provider call, zod-validate |
| Expected flow | `server/services/flow.ts` | compile goal/script → decision graph at agent creation |
| Conformance | `server/services/conformance.ts` | deterministic alignment of actual call → expected flow |
| Voice timeline | `server/services/timeline.ts` | modeled (or ingested) LiveKit-style event timeline |
| Read/aggregation | `server/api/*`, `server/utils/rollup.ts` | rollups into `FleetStats` / `AgentHealth` / `CallDetail` |
| Presentation | `app/pages`, `app/components` | screens, drill-down, transcript highlighting, flow & timeline viz |

---

## The two loops

The assignment splits the problem into **Monitor** and **Analyze**. Both are automated end-to-end:

### Monitor — capture and instrument every call

- **Ingest existing transcripts.** Two transports land calls in storage: a
  **webhook** (`POST /api/webhooks/ghl`) for real-time `call-completed` /
  `transcript-generated` events, and a **PIT poll** (`POST /api/sync`) that pulls
  `/voice-ai/dashboard/call-logs` on demand. Both map a GHL call-log into a
  validated `Call` + `Transcript`.
- **Set observability parameters from the agent's own goal/script.** Each `Agent`
  carries `successCriteria` (outcome / behavior / compliance / tone). When an
  agent has none, `server/services/criteria.ts` **derives** them from its goal and
  script and caches them back on the agent — so monitoring is grounded in what
  *that* agent was actually told to do.
- **Identify deviations, failures, and missed opportunities.** The analysis engine
  emits `findings[]`, each typed `deviation | failure | missed_opportunity`, tied
  to a criterion, given a severity, and **cited by transcript turn index** (never
  invented).

### Analyze — turn signal into action

- **Intuitive fleet dashboard.** KPI cards (fleet health, calls analyzed, failure
  rate, open Use-Actions), a score trend chart, and a sortable agent table — with
  per-agent and per-call drill-down.
- **Immediate recommendations.** Each `recommendation` targets `prompt | script |
  agent_config | training` and ships a **paste-ready `suggestedChange`**, ranked by
  impact and shown inline.
- **"Use Actions".** Specific call segments that need a human or script training are
  flagged with a `turnRange` + `recommendedAction`; the call view **highlights those
  exact transcript turns**, and clicking a finding scrolls to and highlights its
  cited evidence.

---

## Voice-pipeline timeline & flow conformance

This is the part that demonstrates *how voice agents actually work*, and it is deliberate about what is real vs modeled.

### Expected flow → conformance (real, deterministic)

`server/services/flow.ts` compiles each agent's goal/script into an `ExpectedFlow`
(nodes with a `kind` ∈ greeting/intent/qualify/collect/confirm/objection/action/close,
plus branch edges), cached by a hash of the agent's design so it regenerates only
when the design changes. At analysis time the LLM labels each agent turn with the
flow node it enacts (closed-set choices → low hallucination, folded into the *same*
analysis call — no extra round-trip). Then `server/services/conformance.ts` runs a
**deterministic alignment** — process-mining semantics: a designed node with no
matching turn is **skipped**, a turn whose designed predecessor came later is
**out-of-order**, behavior with no designed node is **extra** — and computes a
per-node `driftScore`, a **fitness** (designed steps actually replayed), and an
overall **conformance score**. The arithmetic is reproducible and the deterministic
**mock** provider is its test oracle.

### Event timeline (modeled — and labeled as such)

HighLevel's Voice AI call-log exposes **no per-stage latency** (the transcript is a
flat `bot:/human:` blob). So `server/services/timeline.ts` **models** the pipeline
timeline from the transcript, deterministically (PRNG seeded by `callId`, so it
never flickers), anchored on **published LiveKit budgets**:

| Stage | Modeled value | LiveKit reference |
| --- | --- | --- |
| End-of-utterance (EOU) | ~550 ms | turn-detector `min_delay` ≈ 0.5 s |
| LLM time-to-first-token | ~420 ms | `LLMMetrics.ttft` |
| TTS time-to-first-byte | ~180 ms | `TTSMetrics.ttfb` |
| Response latency identity | `EOU + TTFT + TTFB` | `e2e_latency`, target **< 1 s** |

Interruptions are inferred from **real** transcript markers (an utterance-final `—`
= a barge-in; a mid-sentence em-dash is not). The UI carries a persistent **"Modeled
timing"** badge that cites these exact constants — honesty is a feature, not a
disclaimer.

**Real path exists in code.** HighLevel's *transcription* endpoint
(`/conversations/.../messages/:id/transcription`) returns per-sentence
`startTime`/`endTime` (ms) + ASR `confidence` — the one source of real turn timing.
`server/services/ghl.ts#getMessageTranscription` + `timeline.ts#buildTimelineFromSentences`
consume it: when `POST /api/sync` ingests a call that carries a `messageId`, it
builds an **`ingested`** timeline (real boundaries; only the sub-stage split stays
modeled) and the call view prefers it over the modeled one.

---

## Quickstart

```bash
# 1. Install dependencies
pnpm install

# 2. Pick an analysis engine
#    Default is Ollama running locally. Make sure it's up and the model is pulled:
ollama serve              # if not already running
ollama pull qwen2.5:14b

#    No GPU / want a zero-dependency run? Use the deterministic mock engine:
#       cp .env.example .env   && set LLM_PROVIDER=mock
#    Have a Claude key? Drop in Anthropic:
#       set LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY=sk-ant-...

# 3. Run the dev server
pnpm dev                  # http://localhost:3000
```

Then, in the app:

1. Click **“Load demo data”** — seeds 3+ agents and 6+ transcripts (with
   deliberate deviations, failures, and missed opportunities baked in).
2. Open any **call** to see its analysis: scorecard, findings cited to transcript
   turns, recommendations, and highlighted Use-Action segments.
3. Hit **Re-analyze** to re-run the engine (idempotent — cached by transcript hash
   unless you force it), and watch the fleet KPIs update.

> No HighLevel sandbox required to evaluate locally — the seed data drives the full
> loop. To wire up a real sandbox (PIT sync, webhook, iframe embed), follow
> [`docs/install.md`](docs/install.md).

---

## Team of One — ownership

This was built solo, wearing four hats. How each shaped the result:

**Product.** Framed the work as a *validation flywheel*, not a log viewer: the
unit of value is a **ranked, paste-ready change to a specific agent**, not a chart.
That forced the schema to carry `recommendations.suggestedChange` and
`useActions.turnRange` as first-class fields, and pushed criteria to be derived
from each agent's own goal/script so the scoring is defensible. Scope cut: no
multi-tenant auth or historical cohorting — single-location, current-snapshot.

**Design.** Optimised for *embedded* use inside HighLevel: GHL-native chrome, a
calm KPI-first fleet view, and a call drill-down where the transcript is the hero
and findings act as a clickable index into it. Charts kept to one trend line to
avoid dashboard noise. Scope cut: no theming/branding controls, no dark-mode
toggle beyond what shadcn provides.

**Engineering.** Sliced the system along a frozen `shared/types.ts` contract so
data / api / llm / ui / ghl could be built independently. The LLM provider is a
one-method interface (`complete<T>`) with three implementations, so Ollama,
Claude, and a deterministic mock are interchangeable via one env var. zod
validates model output at the boundary, so a malformed completion fails loudly
instead of corrupting the dashboard. Scope cut: storage is the unstorage fs driver
(no DB/native deps), suitable for a single-node deployment.

**QA.** The deterministic **mock** provider doubles as a test oracle: the whole
loop (seed → analyze → rollup → render) runs with no network and no model, so the
demo is reproducible. Seed transcripts contain *deliberate* failures so every
finding type, severity, and Use-Action path is exercised. Scope cut: no automated
end-to-end test runner is shipped — verification is the documented smoke test
(load demo → open call → re-analyze).

---

## Functional vs. Mocked

| Capability | Status | Notes |
| --- | --- | --- |
| Webhook ingestion transport | **Functional** | `POST /api/webhooks/ghl` upserts call+transcript and triggers analysis. |
| PIT poll ingestion transport | **Functional** | `POST /api/sync` calls GHL `/voice-ai/dashboard/call-logs` with the Private Integration Token. |
| LLM analysis engine | **Functional** | Pluggable Ollama / Anthropic / mock; zod-validated structured output. |
| Expected-flow generation | **Functional** | Real LLM (cached by design hash); shown live on agent creation. |
| Flow conformance / drift scoring | **Functional** | Deterministic alignment over LLM turn-labels; reproducible (mock is the oracle). |
| Storage | **Functional** | Nitro `useStorage('data')`, unstorage fs driver. |
| Dashboard (fleet / agent / call) | **Functional** | shadcn-vue + @unovis charts, drill-down, transcript highlighting. |
| Event-timeline **timing** | **Modeled** | HighLevel exposes no per-stage latency; modeled on cited LiveKit budgets, deterministic, labeled "Modeled timing". |
| Real per-sentence timing ingestion | **Functional (code path)** | `ghl.ts#getMessageTranscription` + `timeline.ts#buildTimelineFromSentences`; produces an `ingested` timeline when a `messageId` is present. |
| Interruption inference | **Modeled (grounded)** | Derived from real utterance-final dash markers in the transcript. |
| iframe embed + CSP `frame-ancestors` | **Functional** | Configured in `nuxt.config.ts`; loads as a GHL Custom Page. |
| Signed user-context decode | **Functional** | `GET /api/context` AES-decrypts the GHL payload via the shared secret. |
| Transcript **content** | **Mocked (seed)** | Realistic seeded transcripts stand in for live call audio→text. |
| Criteria write-back to GHL | **Mocked** | Derived `successCriteria` are cached locally, not pushed to GHL config. |
| Audio playback | **Mocked** | `recordingUrl` is surfaced but the player is not wired. |
| Marketplace OAuth app listing | **Mocked** | Install uses a Private Integration Token, not a published OAuth app. |

---

## Demo script (2–5 min)

1. **Frame it (15s).** “HighLevel customers run fleets of Voice AI agents and have
   no way to know which ones are drifting. This copilot ingests their calls and
   tells them exactly what to fix.”
2. **Ingest + monitor (45s).** Click **Load demo data**. Point out the fleet view:
   KPI cards, the score trend, and the agent table — multiple agents, varying
   health. Note that calls arrived via the same webhook/PIT path a real sandbox
   would use.
3. **Find the worst agent (30s).** Sort the agent table by score; open the
   lowest-scoring agent. Show its health rollup and the recommendations derived
   from *its* goal and script.
4. **Design intent before the call (45s).** Click **New agent**, paste a goal +
   script, hit **Create & design flow** — watch the Copilot generate the agent's
   **expected call flow** (a decision graph with branches) live. This is the
   observability baseline every future call is measured against.
5. **Drill into a call (60s).** Open a flagged call. Walk the scorecard, then click
   a **failure** finding — watch the transcript scroll to and highlight the exact
   cited turns. Show a **missed opportunity** and a **Use-Action** segment.
6. **Flow drift + pipeline timeline (60s).** Open the **Flow drift** tab: the
   designed graph tinted by what was hit/skipped/out-of-order, with a conformance
   score. Then scroll to the **voice-pipeline timeline** — the VAD→STT→EOU→LLM→TTS
   Gantt with latency bars and barge-in markers; call out the **"Modeled timing"**
   badge and the response-latency identity. Back on the agent page, show the
   **flow-drift rollup** ("Offer Retention skipped in 100% of calls") — the flywheel.
7. **Close the loop (30s).** Show a **recommendation** with its paste-ready
   `suggestedChange`. Hit **Re-analyze**. Mention the provider is swappable
   (Ollama → Claude → mock) via one env var.
8. **Land it (15s).** “Raw logs in, ranked fixes out — Monitor and Analyze
   automated, grounded in the agent's designed flow and the realtime pipeline,
   embedded right inside HighLevel.”

---

## Scripts

```bash
pnpm dev        # dev server on http://localhost:3000
pnpm build      # production build
pnpm preview    # preview the production build
pnpm lint       # eslint
pnpm typecheck  # nuxt typecheck (vue-tsc)
```

See [`docs/install.md`](docs/install.md) for the full HighLevel sandbox install,
and [`.env.example`](.env.example) for every configuration key.
