<script setup lang="ts">
import type { CallEvent, CallTimeline, Stage } from '#shared/types'
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

/**
 * CallTimeline — the app's signature "Voice Pipeline Timeline".
 *
 * Renders standalone: the host page wraps it in a <SectionCard
 * title="Voice pipeline timeline">, so this component adds NO outer card or
 * title of its own. It renders only the KPI strip + the fluid SVG gantt +
 * legend.
 *
 * Color discipline — color encodes WHERE LATENCY IS SPENT, not decoration:
 *   · Non-cost lanes (caller / STT / VAD / agent) are low-chroma: neutral
 *     borders for the human-speech lanes, faint teal tint for the system
 *     listening lanes (STT/VAD). They recede.
 *   · Cost lanes (EOU / LLM / TTS) + interruptions carry the only saturated
 *     ink, routed through the --warning / --danger semantic tokens, so the eye
 *     lands on the stages that actually cost time.
 *
 * All status color routes through tokens (no raw emerald-/amber-/red utilities).
 * Motion is gated behind motion-safe + the global prefers-reduced-motion rule.
 */
const props = defineProps<{
  timeline: CallTimeline
  activeTurnIdx?: number | null
}>()

const emit = defineEmits<{
  (e: 'selectTurn', turnIdx: number): void
}>()

const { toneClasses } = useTone()

/* ----------------------------------------------------------------------------
 * Lane definitions — render order top->bottom. 'interruption' is NOT a lane;
 * it renders as full-height vertical ticks across the chart.
 *
 * `fill` / `lane` are CSS custom-property references resolved on the <svg>
 * wrapper from semantic tokens — never raw palette utilities. Cost lanes carry
 * saturated warning/danger ink; non-cost lanes are low-chroma neutral/teal.
 * ------------------------------------------------------------------------- */
type LaneStage = Exclude<Stage, 'interruption'>

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
  // Non-cost: human speech = neutral; system listening (STT/VAD) = faint teal.
  { stage: 'user_speech', label: 'Caller', fill: 'var(--cl-neutral)', lane: 'var(--cl-neutral-soft)', cost: false },
  { stage: 'stt', label: 'STT', fill: 'var(--cl-listen)', lane: 'var(--cl-listen-soft)', cost: false },
  { stage: 'vad', label: 'VAD', fill: 'var(--cl-listen)', lane: 'var(--cl-listen-soft)', cost: false },
  // Cost lanes: saturated semantic ink — this is where latency is spent.
  { stage: 'eou', label: 'Endpoint (EOU)', fill: 'var(--cl-warning)', lane: 'var(--cl-warning-soft)', cost: true },
  { stage: 'llm', label: 'LLM', fill: 'var(--cl-danger)', lane: 'var(--cl-danger-soft)', cost: true },
  { stage: 'tts', label: 'TTS', fill: 'var(--cl-warning)', lane: 'var(--cl-warning-soft)', cost: true },
  // Agent speech = neutral again (the output, not a cost).
  { stage: 'agent_speech', label: 'Agent', fill: 'var(--cl-neutral)', lane: 'var(--cl-neutral-soft)', cost: false }
]

/**
 * Token-backed CSS variables for the chart. Resolved once on the SVG wrapper
 * style so every <rect>/<line> reads a semantic token (not a raw palette hue).
 */
const chartVars = {
  '--cl-neutral': 'var(--muted-foreground)',
  '--cl-neutral-soft': 'color-mix(in oklch, var(--muted-foreground) 8%, transparent)',
  '--cl-listen': 'color-mix(in oklch, var(--primary) 55%, var(--muted-foreground))',
  '--cl-listen-soft': 'color-mix(in oklch, var(--primary) 7%, transparent)',
  '--cl-warning': 'var(--warning)',
  '--cl-warning-soft': 'color-mix(in oklch, var(--warning) 10%, transparent)',
  '--cl-danger': 'var(--danger)',
  '--cl-danger-soft': 'color-mix(in oklch, var(--danger) 10%, transparent)'
} as const

const LANE_INDEX = new Map<string, number>(LANES.map((l, i) => [l.stage, i]))

/* ----------------------------------------------------------------------------
 * Geometry — SVG uses a viewBox so it scales fluidly. x maps to a fixed unit
 * width; y is fixed per lane. The lane-label gutter is baked into the viewBox
 * so rows stay pixel-aligned at every width.
 * ------------------------------------------------------------------------- */
const GUTTER_W = 96 // logical units reserved on the left for lane labels
const PLOT_W = 1000 // logical x units mapped to totalMs
const VB_W = GUTTER_W + PLOT_W + 8 // +8 right pad so end-of-call ticks aren't clipped
const LANE_H = 34
const LANE_GAP = 4
const TOP_PAD = 26 // room for the time axis labels
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
 * Time axis ticks — aim for ~1s spacing, but adapt step so we don't overcrowd.
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
}

const MIN_SEG_W = 3 // logical units so a 0-width latency marker is still visible

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
        && ev.turnIdx != null
        && ev.turnIdx === props.activeTurnIdx
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

const totalSeconds = computed(() => (props.timeline.totalMs / 1000).toFixed(1))

/** A small set of headline per-stage p50 chips, in a sensible reading order. */
const stageChips = computed(() => {
  const wanted: { stage: Stage, label: string }[] = [
    { stage: 'stt', label: 'STT' },
    { stage: 'eou', label: 'EOU' },
    { stage: 'llm', label: 'LLM TTFT' },
    { stage: 'tts', label: 'TTS TTFB' }
  ]
  const byStage = new Map(props.timeline.perStageLatency.map(s => [s.stage, s]))
  return wanted
    .map(w => ({ ...w, lat: byStage.get(w.stage) }))
    .filter(c => c.lat && c.lat.count > 0)
    .map(c => ({ label: c.label, p50: Math.round(c.lat!.p50Ms) }))
})

const isModeled = computed(() => props.timeline.source === 'modeled')

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
            : ev.type
    return `${lane} ${kind}: ${fmtDur(ev.latencyMs)}`
  }
  const dur = ev.tEndMs - ev.tStartMs
  const verb = ev.stage === 'user_speech' || ev.stage === 'agent_speech' ? 'speech' : ev.type
  return `${lane} ${verb}: ${fmtDur(dur)}`
}

function onSegClick(s: Segment) {
  if (s.ev.turnIdx != null) emit('selectTurn', s.ev.turnIdx)
}

/** Keyboard activation for an interactive segment (Enter / Space). */
function onSegKey(e: KeyboardEvent, s: Segment) {
  if (s.ev.turnIdx == null) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('selectTurn', s.ev.turnIdx)
  }
}
</script>

<template>
  <div
    class="flex flex-col gap-4"
    :style="chartVars"
  >
    <!-- Honesty flag + KPI strip -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-end">
        <!-- Modeled-timing honesty popover (credibility asset — kept) -->
        <Popover v-if="isModeled">
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
                Modeled timing
              </Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent
            class="w-80 text-xs leading-relaxed"
            align="end"
          >
            <p class="mb-2 text-sm font-semibold text-foreground">
              Stage latencies are modeled, not measured.
            </p>
            <p class="text-muted-foreground">
              HighLevel's Voice AI API does not expose per-stage latency. Stage
              timings are modeled on published LiveKit budgets — end-of-utterance
              <span class="font-medium text-foreground">~550ms</span> (turn
              detector), LLM TTFT
              <span class="font-medium text-foreground">~420ms</span>, TTS TTFB
              <span class="font-medium text-foreground">~180ms</span>; identity
              e2e &asymp; EOU + TTFT + TTFB, target &lt; 1s. Turn boundaries derive
              from the transcript; deterministic per call.
            </p>
            <p class="mt-2 font-mono text-[11px] text-muted-foreground">
              model {{ timeline.modelVersion }}
            </p>
          </PopoverContent>
        </Popover>

        <Badge
          v-else
          variant="outline"
          :class="cn('gap-1', toneClasses('success').badge, 'border-success/40')"
        >
          <span class="size-1.5 rounded-full bg-success" />
          Real timing (HighLevel)
        </Badge>
      </div>

      <div class="flex flex-wrap items-stretch gap-2">
        <!-- Headline: avg response latency -->
        <div
          class="flex min-w-[15rem] flex-1 flex-col gap-0.5 rounded-md border bg-card px-3 py-2"
        >
          <span class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <span :class="cn('size-1.5 rounded-full', avgTone.dot)" />
            Avg response latency (EOU&rarr;first audio)
          </span>
          <div class="flex items-baseline gap-2">
            <span :class="cn('text-2xl font-semibold tabular-nums', avgTone.text)">
              {{ avgMs }}<span class="text-sm font-normal">ms</span>
            </span>
            <span class="text-[12px] text-muted-foreground">target &lt; 1000ms</span>
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

        <div class="flex flex-col justify-center gap-0.5 rounded-md border bg-card px-3 py-2">
          <span class="text-[12px] font-medium text-muted-foreground">Call duration</span>
          <span class="text-2xl font-semibold tabular-nums text-foreground">
            {{ totalSeconds }}<span class="text-sm font-normal">s</span>
          </span>
        </div>

        <div
          v-if="stageChips.length"
          class="flex flex-1 flex-col justify-center gap-1 rounded-md border bg-card px-3 py-2"
        >
          <span class="text-[12px] font-medium text-muted-foreground">Per-stage p50</span>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="chip in stageChips"
              :key="chip.label"
              class="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-medium tabular-nums"
            >
              <span class="text-muted-foreground">{{ chip.label }}</span>
              <span class="text-foreground">{{ chip.p50 }}ms</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Gantt: single fluid SVG (lane-label gutter baked into the viewBox so
         rows stay pixel-aligned at every width; uniform scaling, no distortion). -->
    <TooltipProvider :delay-duration="80">
      <div class="min-w-0">
        <svg
          :viewBox="`0 0 ${VB_W} ${VB_H}`"
          class="h-auto w-full overflow-visible"
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label="Voice pipeline event timeline — color marks the cost stages (endpoint, LLM, TTS) where latency is spent"
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
                  :tabindex="s.ev.turnIdx != null ? 0 : undefined"
                  :role="s.ev.turnIdx != null ? 'button' : undefined"
                  :aria-label="s.ev.turnIdx != null ? `${segLabel(s)}, turn ${s.ev.turnIdx} — activate to highlight transcript` : segLabel(s)"
                  :class="cn(
                    'outline-none',
                    'motion-safe:transition-opacity motion-safe:duration-[var(--dur)] motion-safe:ease-[var(--ease)]',
                    s.ev.turnIdx != null ? 'cursor-pointer focus-visible:[&>rect:first-of-type]:stroke-primary' : 'cursor-default',
                    activeTurnIdx != null && !s.active ? 'opacity-40' : 'opacity-100'
                  )"
                  @click="onSegClick(s)"
                  @keydown="onSegKey($event, s)"
                >
                  <!-- the bar -->
                  <rect
                    :x="s.x"
                    :y="s.y + 5"
                    :width="s.w"
                    :height="LANE_H - 10"
                    :rx="s.lane.cost ? 3 : 5"
                    :style="{ fill: s.lane.fill }"
                    stroke-width="1.5"
                    vector-effect="non-scaling-stroke"
                    :class="cn(
                      s.lane.cost ? 'opacity-95' : 'opacity-70',
                      'hover:opacity-100'
                    )"
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
                  <!-- diagonal hatch on cost bars so they read as "cost" -->
                  <rect
                    v-if="s.lane.cost"
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
                <div
                  v-if="s.ev.turnIdx != null"
                  class="mt-0.5 text-muted-foreground"
                >
                  Turn #{{ s.ev.turnIdx }} · click to highlight transcript
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
                  <!-- invisible wide hit area -->
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
                  {{ it.ev.type }} @ {{ fmtDur(it.ev.tStartMs) }}<span v-if="it.ev.turnIdx != null"> · turn #{{ it.ev.turnIdx }}</span>
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
    </TooltipProvider>

    <!-- Legend — grouped so color reads as a key, not decoration -->
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
        <span class="relative size-2.5 overflow-hidden rounded-[3px]">
          <span
            class="absolute inset-0"
            :style="{ backgroundColor: 'var(--cl-warning)' }"
          />
          <span class="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_1.5px,rgba(255,255,255,0.5)_1.5px,rgba(255,255,255,0.5)_3px)]" />
        </span>
        Cost stages — EOU · LLM · TTS
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-3 w-px bg-danger" />
        Interruption
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-[3px] ring-2 ring-inset ring-primary" />
        Selected turn
      </span>
    </div>

    <!-- Static caption — surfaces the interaction without relying on hover -->
    <p class="text-[12px] text-muted-foreground">
      Click a bar to highlight the cited turn in the transcript.
    </p>
  </div>
</template>
