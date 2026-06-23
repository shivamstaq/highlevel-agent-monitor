<!-- CREATED (our eval layer) — the signature "Voice Pipeline Timeline".
     HONESTY (contract source:'partial-real'): the headline response latency +
     per-turn latencies are REAL (derived from GHL transcript turn times); the
     per-stage VAD/STT/EOU/LLM/TTS sub-stage events are MODELED and flagged as
     such (CallEvent.provenance). Color never decorates — it marks WHERE LATENCY
     IS SPENT and which segments are modeled vs measured. -->
<script setup lang="ts">
import type { CallEvent, CallTimeline, TimelineStage } from '#shared/types'
import { computed } from 'vue'
import { Info } from 'lucide-vue-next'
import { Badge } from '~/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '~/components/ui/tooltip'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

const props = defineProps<{
  timeline: CallTimeline
  /** The active transcript ENTRY idx — rings the matching segment. */
  activeTurnIdx?: number | null
  /**
   * The call's TRUE wall-clock duration (Call.durationSec). The "Pipeline span"
   * KPI renders this real value formatted m:ss (matching the call header) so the
   * two never contradict (P05). Falls back to totalMs when absent.
   */
  durationSec?: number
}>()

const emit = defineEmits<{
  (e: 'selectTurn', entryIdx: number): void
}>()

const { toneClasses } = useTone()

/* ----------------------------------------------------------------------------
 * Lane definitions — render order top->bottom. 'interruption' is NOT a lane;
 * it renders as full-height vertical ticks across the chart.
 *
 * Cost lanes (EOU / LLM / TTS) + interruptions carry the only saturated ink,
 * routed through --warning / --danger; non-cost lanes are low-chroma.
 * ------------------------------------------------------------------------- */
type LaneStage = Exclude<TimelineStage, 'interruption'>

interface LaneDef {
  stage: LaneStage
  label: string
  /** segment + dot fill (CSS var pointing at a token) */
  fill: string
  /** faint lane-background fill (CSS var pointing at a token, low alpha) */
  lane: string
  /** is this a "cost"/latency lane (eou/llm/tts) */
  cost: boolean
}

const LANES: LaneDef[] = [
  { stage: 'user_speech', label: 'Caller', fill: 'var(--cl-neutral)', lane: 'var(--cl-neutral-soft)', cost: false },
  { stage: 'stt', label: 'STT', fill: 'var(--cl-listen)', lane: 'var(--cl-listen-soft)', cost: false },
  { stage: 'vad', label: 'VAD', fill: 'var(--cl-listen)', lane: 'var(--cl-listen-soft)', cost: false },
  { stage: 'eou', label: 'Endpoint (EOU)', fill: 'var(--cl-warning)', lane: 'var(--cl-warning-soft)', cost: true },
  { stage: 'llm', label: 'LLM', fill: 'var(--cl-warning)', lane: 'var(--cl-warning-soft)', cost: true },
  { stage: 'tts', label: 'TTS', fill: 'var(--cl-warning)', lane: 'var(--cl-warning-soft)', cost: true },
  { stage: 'agent_speech', label: 'Agent', fill: 'var(--cl-neutral)', lane: 'var(--cl-neutral-soft)', cost: false }
]

/** Token-backed CSS variables for the chart (resolved on the SVG wrapper). */
const chartVars = {
  '--cl-neutral': 'var(--muted-foreground)',
  '--cl-neutral-soft': 'color-mix(in oklch, var(--muted-foreground) 8%, transparent)',
  '--cl-listen': 'color-mix(in oklch, var(--primary) 55%, var(--muted-foreground))',
  '--cl-listen-soft': 'color-mix(in oklch, var(--primary) 7%, transparent)',
  '--cl-warning': 'var(--warning)',
  '--cl-warning-soft': 'color-mix(in oklch, var(--warning) 10%, transparent)',
  '--cl-cost-ok': 'color-mix(in oklch, var(--warning) 60%, var(--muted-foreground))',
  '--cl-danger': 'var(--danger)',
  '--cl-danger-soft': 'color-mix(in oklch, var(--danger) 10%, transparent)'
} as const

const LANE_INDEX = new Map<string, number>(LANES.map((l, i) => [l.stage, i]))

/* ----------------------------------------------------------------------------
 * Per-cost-stage MODELED budgets (LiveKit-published means, mirrored in the
 * Modeled-timing popover). Cost-lane saturation is DATA-DRIVEN — within budget
 * stays low-chroma; over budget escalates to saturated danger ink.
 * ------------------------------------------------------------------------- */
const COST_BUDGET_MS: Partial<Record<LaneStage, number>> = {
  eou: 550, // end-of-utterance turn detector
  llm: 420, // LLM TTFT
  tts: 180 // TTS TTFB
}

/** True when a cost segment's modeled latency exceeds its budget. */
function isOverBudget(ev: CallEvent): boolean {
  const budget = COST_BUDGET_MS[ev.stage as LaneStage]
  if (budget == null || ev.latencyMs == null) return false
  return ev.latencyMs > budget
}

/* ----------------------------------------------------------------------------
 * Geometry — SVG uses a viewBox so it scales fluidly.
 * ------------------------------------------------------------------------- */
const GUTTER_W = 96
const PLOT_W = 1000
const VB_W = GUTTER_W + PLOT_W + 8
const LANE_H = 34
const LANE_GAP = 4
const TOP_PAD = 26
const BOT_PAD = 6

const chartH = computed(() => LANES.length * (LANE_H + LANE_GAP) - LANE_GAP)
const VB_H = computed(() => TOP_PAD + chartH.value + BOT_PAD)

const totalMs = computed(() => Math.max(props.timeline.totalMs, 1))

function xOf(ms: number): number {
  return GUTTER_W + (Math.max(0, Math.min(ms, totalMs.value)) / totalMs.value) * PLOT_W
}

function laneY(stage: string): number {
  const i = LANE_INDEX.get(stage) ?? 0
  return TOP_PAD + i * (LANE_H + LANE_GAP)
}

/* ----------------------------------------------------------------------------
 * Time axis ticks — aim for ~1s spacing, adapt step so we don't overcrowd.
 * ------------------------------------------------------------------------- */
const ticks = computed(() => {
  const total = totalMs.value
  const candidates = [250, 500, 1000, 2000, 2500, 5000, 10000]
  let step = 1000
  for (const c of candidates) {
    if (total / c <= 12) {
      step = c
      break
    }
    step = c
  }
  const out: { ms: number, x: number, label: string }[] = []
  for (let ms = 0; ms <= total + 1; ms += step) {
    out.push({ ms, x: xOf(ms), label: fmtAxis(ms) })
  }
  return out
})

function fmtAxis(ms: number): string {
  if (ms === 0) return '0'
  if (ms >= 1000) {
    const s = ms / 1000
    return `${Number.isInteger(s) ? s : s.toFixed(1)}s`
  }
  return `${ms}ms`
}

/* ----------------------------------------------------------------------------
 * Segments — one rounded rect per (non-interruption) event.
 * ------------------------------------------------------------------------- */
interface Segment {
  ev: CallEvent
  lane: LaneDef
  x: number
  w: number
  y: number
  active: boolean
  /** Cost segment over its modeled budget — drives saturated danger fill. */
  over: boolean
  /** This sub-stage event is MODELED (not measured) — drives the dashed key. */
  modeled: boolean
  /** Resolved segment fill: within-budget cost = muted warning; over = danger. */
  fill: string
}

const MIN_SEG_W = 3

function segFill(ev: CallEvent, lane: LaneDef): string {
  if (!lane.cost) return lane.fill
  return isOverBudget(ev) ? 'var(--cl-danger)' : 'var(--cl-cost-ok)'
}

const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  for (const ev of props.timeline.events) {
    if (ev.stage === 'interruption') continue
    const lane = LANES[LANE_INDEX.get(ev.stage) ?? -1]
    if (!lane) continue
    const x = xOf(ev.tStartMs)
    const x2 = xOf(Math.max(ev.tEndMs, ev.tStartMs))
    const w = Math.max(x2 - x, MIN_SEG_W)
    out.push({
      ev,
      lane,
      x,
      w,
      y: laneY(ev.stage),
      active:
        props.activeTurnIdx != null
        && ev.entryIdx != null
        && ev.entryIdx === props.activeTurnIdx,
      over: lane.cost && isOverBudget(ev),
      modeled: ev.provenance === 'modeled',
      fill: segFill(ev, lane)
    })
  }
  return out
})

const interruptions = computed(() =>
  props.timeline.events
    .filter(e => e.stage === 'interruption')
    .map(e => ({ ev: e, x: xOf(e.tStartMs) }))
)

/* ----------------------------------------------------------------------------
 * KPI header
 * ------------------------------------------------------------------------- */
const avgMs = computed(() => Math.round(props.timeline.avgResponseLatencyMs))

/** Latency tone band — routed through semantic tokens (<=1s ok, <=1.5s warn). */
const avgTone = computed(() => {
  const v = avgMs.value
  if (v <= 1000) return toneClasses('success')
  if (v <= 1500) return toneClasses('warning')
  return toneClasses('danger')
})

const spanSec = computed(() =>
  props.durationSec != null && props.durationSec > 0
    ? props.durationSec
    : props.timeline.totalMs / 1000
)

const spanLabel = computed(() => {
  const total = Math.round(spanSec.value)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

/**
 * Headline per-stage p50 chips — the COST stages so "where time is spent" reads
 * cleanly. Derived from the MODELED sub-stage events (median latency per cost
 * stage). The e2e chip is REAL (avgResponseLatencyMs).
 */
const stageChips = computed(() => {
  const wanted: { stage: LaneStage, label: string }[] = [
    { stage: 'eou', label: 'EOU' },
    { stage: 'llm', label: 'LLM TTFT' },
    { stage: 'tts', label: 'TTS TTFB' }
  ]
  const byStage = new Map<string, number[]>()
  for (const ev of props.timeline.events) {
    if (ev.latencyMs == null) continue
    const arr = byStage.get(ev.stage) ?? []
    arr.push(ev.latencyMs)
    byStage.set(ev.stage, arr)
  }
  function p50(values: number[]): number {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
  }
  const chips = wanted
    .map(w => ({ ...w, vals: byStage.get(w.stage) ?? [] }))
    .filter(c => c.vals.length > 0)
    .map(c => ({ label: c.label, p50: Math.round(p50(c.vals)), modeled: true }))
  // e2e: the REAL headline boundary metric (caller stops → agent speaks).
  if (avgMs.value > 0) chips.push({ label: 'e2e', p50: avgMs.value, modeled: false })
  return chips
})

/** Count of measured per-turn latencies (REAL) — credibility anchor. */
const realTurnCount = computed(() => props.timeline.perTurnLatency.length)

/* ----------------------------------------------------------------------------
 * Formatting helpers for tooltips
 * ------------------------------------------------------------------------- */
function fmtDur(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`
  return `${Math.round(ms)}ms`
}

function segLabel(s: Segment): string {
  const lane = s.lane.label
  const ev = s.ev
  if (s.lane.cost && ev.latencyMs != null) {
    const kind
      = ev.stage === 'eou'
        ? 'turn detector'
        : ev.stage === 'llm'
          ? 'TTFT'
          : ev.stage === 'tts'
            ? 'TTFB'
            : 'latency'
    const budget = COST_BUDGET_MS[ev.stage as LaneStage]
    const verdict = budget != null
      ? ` (${s.over ? 'over' : 'within'} ${fmtDur(budget)} budget)`
      : ''
    return `${lane} ${kind}: ${fmtDur(ev.latencyMs)}${verdict}`
  }
  const dur = ev.tEndMs - ev.tStartMs
  const verb = ev.stage === 'user_speech' || ev.stage === 'agent_speech' ? 'speech' : 'window'
  return `${lane} ${verb}: ${fmtDur(dur)}`
}

function onSegClick(s: Segment) {
  if (s.ev.entryIdx != null) emit('selectTurn', s.ev.entryIdx)
}

/** Keyboard activation for an interactive segment (Enter / Space). */
function onSegKey(e: KeyboardEvent, s: Segment) {
  if (s.ev.entryIdx == null) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('selectTurn', s.ev.entryIdx)
  }
}
</script>

<template>
  <TooltipProvider :delay-duration="80">
    <div
      class="flex flex-col gap-4"
      :style="chartVars"
    >
      <!-- Honesty flag + KPI strip. source is always 'partial-real': REAL turn
           latency + MODELED sub-stages. -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-end gap-2">
          <Badge
            variant="outline"
            :class="cn('gap-1', toneClasses('success').badge, 'border-success/40')"
          >
            <span class="size-1.5 rounded-full bg-success" />
            Real turn latency (HighLevel)
          </Badge>
          <!-- Modeled sub-stage honesty popover (credibility asset). -->
          <Popover>
            <PopoverTrigger as-child>
              <button
                type="button"
                class="cursor-help rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Badge
                  variant="outline"
                  :class="cn('gap-1', toneClasses('warning').badge, 'border-warning/40')"
                >
                  <Info class="size-3" />
                  Modeled sub-stages
                </Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent
              class="w-80 text-xs leading-relaxed"
              align="end"
            >
              <p class="mb-2 text-sm font-semibold text-foreground">
                Per-stage timings are modeled, not measured.
              </p>
              <p class="text-muted-foreground">
                The headline response latency and the
                <span class="font-medium text-foreground">{{ realTurnCount }}</span>
                per-turn latencies below are <span class="font-medium text-foreground">REAL</span> —
                derived from HighLevel's transcript turn times (caller stops →
                agent speaks). HighLevel does not expose the per-stage
                VAD/STT/EOU/LLM/TTS breakdown, so those sub-stage bars are
                <span class="font-medium text-foreground">modeled</span> on published
                LiveKit budgets — end-of-utterance
                <span class="font-medium text-foreground">~550ms</span>, LLM TTFT
                <span class="font-medium text-foreground">~420ms</span>, TTS TTFB
                <span class="font-medium text-foreground">~180ms</span>; e2e &lt; 1s
                target — and rescaled to this call's real length. Modeled bars carry
                a dashed outline.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        <div class="flex flex-wrap items-stretch gap-2">
          <!-- Headline: REAL response latency at the honest boundary (caller
               stops → agent speaks). -->
          <div
            class="flex min-w-[16rem] flex-1 flex-col gap-0.5 rounded-md border bg-card px-3 py-2"
          >
            <span class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <span :class="cn('size-1.5 rounded-full', avgTone.dot)" />
              Response latency · caller stops to agent speaks
            </span>
            <div class="flex items-baseline gap-2">
              <span :class="cn('text-2xl font-semibold tabular-nums', avgTone.text)">
                {{ avgMs }}<span class="text-sm font-normal">ms</span>
              </span>
              <span class="text-[12px] text-muted-foreground">reference &lt; 1000ms (LiveKit)</span>
            </div>
          </div>

          <div class="flex flex-col justify-center gap-0.5 rounded-md border bg-card px-3 py-2">
            <span class="text-[12px] font-medium text-muted-foreground">Interruptions</span>
            <span
              :class="cn(
                'text-2xl font-semibold tabular-nums',
                timeline.interruptionCount > 0 ? toneClasses('danger').text : 'text-foreground'
              )"
            >{{ timeline.interruptionCount }}</span>
          </div>

          <!-- Pipeline span (P05): the call's TRUE duration, m:ss like the header. -->
          <Tooltip>
            <TooltipTrigger as-child>
              <div class="flex cursor-help flex-col justify-center gap-0.5 rounded-md border bg-card px-3 py-2">
                <span class="text-[12px] font-medium text-muted-foreground">Pipeline span</span>
                <span class="text-2xl font-semibold tabular-nums text-foreground">
                  {{ spanLabel }}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent class="max-w-xs text-xs leading-relaxed">
              Matches the call's real duration. The modeled stage timings are
              rescaled to fit this span (inter-turn silence is collapsed, then
              stretched back), so the bars show proportion, not wall-clock offsets.
            </TooltipContent>
          </Tooltip>

          <div
            v-if="stageChips.length"
            class="flex flex-1 flex-col justify-center gap-1 rounded-md border bg-card px-3 py-2"
          >
            <span class="text-[12px] font-medium text-muted-foreground">Per-stage p50</span>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="chip in stageChips"
                :key="chip.label"
                :class="cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium tabular-nums',
                  chip.modeled ? 'border border-dashed bg-muted/60' : 'bg-muted'
                )"
                :title="chip.modeled ? 'Modeled sub-stage' : 'Real (measured)'"
              >
                <span class="text-muted-foreground">{{ chip.label }}</span>
                <span class="text-foreground">{{ chip.p50 }}ms</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Gantt: single fluid SVG (lane-label gutter baked into the viewBox). -->
      <div class="min-w-0">
        <svg
          :viewBox="`0 0 ${VB_W} ${VB_H}`"
          class="h-auto w-full overflow-visible"
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label="Voice pipeline event timeline — color marks the cost stages (endpoint, LLM, TTS) where latency is spent; dashed bars are modeled sub-stages"
        >
          <!-- lane label gutter -->
          <g>
            <template
              v-for="lane in LANES"
              :key="`gut-${lane.stage}`"
            >
              <rect
                x="0"
                :y="laneY(lane.stage) + LANE_H / 2 - 4"
                width="8"
                height="8"
                rx="2"
                :style="{ fill: lane.fill }"
              />
              <text
                x="14"
                :y="laneY(lane.stage) + LANE_H / 2 + 3.5"
                class="fill-muted-foreground"
                font-size="10"
                font-weight="500"
              >{{ lane.label }}</text>
            </template>
          </g>

          <!-- x-axis gridlines + labels -->
          <g>
            <line
              v-for="t in ticks"
              :key="`grid-${t.ms}`"
              :x1="t.x"
              :x2="t.x"
              :y1="TOP_PAD - 4"
              :y2="TOP_PAD + chartH"
              class="stroke-border"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
              :stroke-dasharray="t.ms === 0 ? '0' : '2 3'"
            />
            <text
              v-for="t in ticks"
              :key="`lbl-${t.ms}`"
              :x="t.x + 2"
              :y="TOP_PAD - 10"
              class="fill-muted-foreground"
              font-size="9"
              style="font-variant-numeric: tabular-nums"
            >{{ t.label }}</text>
          </g>

          <!-- lane backgrounds -->
          <g>
            <rect
              v-for="lane in LANES"
              :key="`lane-${lane.stage}`"
              :x="GUTTER_W"
              :y="laneY(lane.stage)"
              :width="PLOT_W"
              :height="LANE_H"
              rx="4"
              :style="{ fill: lane.lane }"
            />
          </g>

          <!-- event segments -->
          <g>
            <Tooltip
              v-for="(s, i) in segments"
              :key="s.ev.id ?? `seg-${i}`"
            >
              <TooltipTrigger as-child>
                <g
                  :tabindex="s.ev.entryIdx != null ? 0 : undefined"
                  :role="s.ev.entryIdx != null ? 'button' : undefined"
                  :aria-label="s.ev.entryIdx != null ? `${segLabel(s)}, entry ${s.ev.entryIdx} — activate to highlight transcript` : segLabel(s)"
                  :class="cn(
                    'outline-none',
                    'motion-safe:transition-opacity motion-safe:duration-[var(--dur)] motion-safe:ease-[var(--ease)]',
                    s.ev.entryIdx != null ? 'cursor-pointer focus-visible:[&>rect:first-of-type]:stroke-primary' : 'cursor-default',
                    activeTurnIdx != null && !s.active ? 'opacity-40' : 'opacity-100'
                  )"
                  @click="onSegClick(s)"
                  @keydown="onSegKey($event, s)"
                >
                  <!-- the bar — cost segments tint by latency vs budget; modeled
                       sub-stages carry a dashed outline so they read as modeled -->
                  <rect
                    :x="s.x"
                    :y="s.y + 5"
                    :width="s.w"
                    :height="LANE_H - 10"
                    :rx="s.lane.cost ? 3 : 5"
                    :style="{ fill: s.fill }"
                    stroke-width="1.2"
                    :stroke-dasharray="s.modeled ? '3 2' : '0'"
                    :class="cn(
                      s.modeled ? 'stroke-muted-foreground/50' : 'stroke-transparent',
                      s.lane.cost ? (s.over ? 'opacity-100' : 'opacity-80') : 'opacity-70',
                      'hover:opacity-100'
                    )"
                    vector-effect="non-scaling-stroke"
                  />
                  <!-- active highlight ring (accent) -->
                  <rect
                    v-if="s.active"
                    :x="s.x"
                    :y="s.y + 5"
                    :width="s.w"
                    :height="LANE_H - 10"
                    :rx="s.lane.cost ? 3 : 5"
                    fill="none"
                    class="stroke-primary"
                    stroke-width="2"
                    vector-effect="non-scaling-stroke"
                  />
                  <!-- diagonal hatch ONLY on OVER-budget cost bars -->
                  <rect
                    v-if="s.over"
                    :x="s.x"
                    :y="s.y + 5"
                    :width="s.w"
                    :height="LANE_H - 10"
                    :rx="3"
                    fill="url(#costHatch)"
                    class="pointer-events-none"
                  />
                </g>
              </TooltipTrigger>
              <TooltipContent class="text-xs">
                <div class="font-medium">
                  {{ segLabel(s) }}
                </div>
                <div class="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                  <span :class="cn('inline-block size-1.5 rounded-full', s.modeled ? 'bg-warning' : 'bg-success')" />
                  {{ s.modeled ? 'Modeled sub-stage' : 'Real timing' }}
                </div>
                <div
                  v-if="s.ev.entryIdx != null"
                  class="mt-0.5 text-muted-foreground"
                >
                  Entry #{{ s.ev.entryIdx }} · click to highlight transcript
                </div>
              </TooltipContent>
            </Tooltip>
          </g>

          <!-- interruption ticks (full-height vertical markers, danger token) -->
          <g>
            <Tooltip
              v-for="(it, i) in interruptions"
              :key="it.ev.id ?? `int-${i}`"
            >
              <TooltipTrigger as-child>
                <g
                  tabindex="0"
                  role="img"
                  :aria-label="`Interruption (barge-in) at ${fmtDur(it.ev.tStartMs)}`"
                  class="cursor-pointer outline-none focus-visible:[&>line]:stroke-primary"
                >
                  <rect
                    :x="it.x - 4"
                    :y="TOP_PAD - 4"
                    width="8"
                    :height="chartH + 4"
                    fill="transparent"
                  />
                  <line
                    :x1="it.x"
                    :x2="it.x"
                    :y1="TOP_PAD - 4"
                    :y2="TOP_PAD + chartH"
                    class="stroke-danger"
                    stroke-width="1.5"
                    vector-effect="non-scaling-stroke"
                  />
                  <polygon
                    :points="`${it.x - 3},${TOP_PAD - 4} ${it.x + 3},${TOP_PAD - 4} ${it.x},${TOP_PAD + 1}`"
                    class="fill-danger"
                  />
                </g>
              </TooltipTrigger>
              <TooltipContent class="text-xs">
                <div :class="cn('font-medium', toneClasses('danger').text)">
                  Interruption (barge-in)
                </div>
                <div class="mt-0.5 text-muted-foreground">
                  @ {{ fmtDur(it.ev.tStartMs) }}<span v-if="it.ev.entryIdx != null"> · entry #{{ it.ev.entryIdx }}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          </g>

          <defs>
            <pattern
              id="costHatch"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="5"
                stroke="white"
                stroke-opacity="0.22"
                stroke-width="1.4"
              />
            </pattern>
          </defs>
        </svg>
      </div>

      <!-- Legend — color is a KEY for where latency is spent, not decoration. -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-[12px] text-muted-foreground">
        <span class="font-medium text-foreground">Where time is spent</span>
        <span class="inline-flex items-center gap-1.5">
          <span
            class="size-2.5 rounded-[3px]"
            :style="{ backgroundColor: 'var(--cl-neutral)', opacity: 0.7 }"
          />
          Speech &amp; listening (caller · STT · VAD · agent)
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span
            class="size-2.5 rounded-[3px] opacity-80"
            :style="{ backgroundColor: 'var(--cl-cost-ok)' }"
          />
          Cost stage within budget (EOU · LLM · TTS)
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="relative size-2.5 overflow-hidden rounded-[3px]">
            <span
              class="absolute inset-0"
              :style="{ backgroundColor: 'var(--cl-danger)' }"
            />
            <span class="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_1.5px,rgba(255,255,255,0.5)_1.5px,rgba(255,255,255,0.5)_3px)]" />
          </span>
          Cost stage over budget
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2.5 rounded-[3px] border border-dashed border-muted-foreground/60" />
          Modeled sub-stage
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-3 w-px bg-danger" />
          Interruption
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2.5 rounded-[3px] ring-2 ring-inset ring-primary" />
          Selected entry
        </span>
      </div>

      <!-- Static captions — interaction hint + one-line honesty definition. -->
      <p class="text-[12px] text-muted-foreground">
        Click a bar to highlight the cited entry in the transcript.
      </p>
      <p class="text-[12px] text-muted-foreground">
        <span class="font-medium text-foreground">Partial-real timeline:</span>
        the response-latency headline and per-turn latencies are measured from
        HighLevel's transcript; the per-stage breakdown (dashed bars) is modeled
        from published LiveKit budgets and rescaled to this call's real length.
      </p>
    </div>
  </TooltipProvider>
</template>
