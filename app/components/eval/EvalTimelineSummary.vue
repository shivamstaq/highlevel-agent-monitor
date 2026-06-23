<script setup lang="ts">
// CREATED (our eval layer) — honest voice-pipeline timeline SUMMARY.
/**
 * EvalTimelineSummary — the compact, honesty-first readout of the rebuilt
 * CallTimeline (`source: 'partial-real'`).
 *
 * Provenance is explicit per the contract:
 *   - REAL (from GHL transcript times): the headline response latency
 *     (caller-end → agent-start), the per-turn latency series, the interruption
 *     (barge-in) count, and the total span.
 *   - MODELED (NOT exposed by GHL): the per-stage VAD/STT/EOU/LLM/TTS sub-stage
 *     breakdown inside `events[]` — each flagged via `event.provenance`. We label
 *     the modeled portion plainly and never present it as measured.
 *
 * Clicking a per-turn bar emits `entry:select` (the responding agent entry idx)
 * so the host can highlight that transcript entry.
 */
import { computed } from 'vue'
import { Info } from 'lucide-vue-next'
import type { CallTimeline } from '#shared/types'
import { Badge } from '~/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

const props = defineProps<{
  timeline: CallTimeline
}>()

const emit = defineEmits<{
  (e: 'entry:select', entryIdx: number): void
}>()

const { toneClasses } = useTone()

const avgMs = computed(() => Math.round(props.timeline.avgResponseLatencyMs))

/** Latency band — token-routed (<=1s ok, <=1.5s warn, else danger). */
const avgTone = computed(() => {
  const v = avgMs.value
  if (v <= 1000) return toneClasses('success')
  if (v <= 1500) return toneClasses('warning')
  return toneClasses('danger')
})

const totalSec = computed(() => props.timeline.totalMs / 1000)
const spanLabel = computed(() => {
  const total = Math.round(totalSec.value)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

/** Per-turn latencies, scaled to the slowest turn for the mini bar chart. */
const maxTurnMs = computed(() =>
  props.timeline.perTurnLatency.reduce((m, p) => Math.max(m, p.latencyMs), 1)
)
const turns = computed(() => props.timeline.perTurnLatency)

/** How many modeled sub-stage events back this timeline (honesty footnote). */
const modeledCount = computed(() =>
  props.timeline.events.filter(e => e.provenance === 'modeled').length
)

function barTone(ms: number) {
  if (ms <= 1000) return toneClasses('success')
  if (ms <= 1500) return toneClasses('warning')
  return toneClasses('danger')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Provenance flag -->
    <div class="flex items-center justify-between gap-2">
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
              Partial-real timing
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent
          class="w-80 text-xs leading-relaxed"
          align="start"
        >
          <p class="mb-2 text-sm font-semibold text-foreground">
            Real latency, modeled sub-stages.
          </p>
          <p class="text-muted-foreground">
            Response latency, the per-turn series, interruptions, and total span are
            <span class="font-medium text-foreground">REAL</span> — derived from
            HighLevel's transcript turn times. The per-stage VAD / STT / EOU / LLM /
            TTS breakdown is <span class="font-medium text-foreground">MODELED</span>
            ({{ modeledCount }} sub-stage event{{ modeledCount === 1 ? '' : 's' }}),
            since GHL does not expose per-stage latency.
          </p>
        </PopoverContent>
      </Popover>
    </div>

    <!-- KPI strip (all REAL) -->
    <div class="grid grid-cols-3 gap-2">
      <div class="flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2">
        <span class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <span :class="cn('size-1.5 rounded-full', avgTone.dot)" />
          Response latency
        </span>
        <span :class="cn('text-xl font-semibold tabular-nums', avgTone.text)">
          {{ avgMs }}<span class="text-xs font-normal">ms</span>
        </span>
        <span class="text-[11px] text-muted-foreground">caller stops → agent speaks</span>
      </div>
      <div class="flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2">
        <span class="text-[12px] font-medium text-muted-foreground">Interruptions</span>
        <span
          :class="cn(
            'text-xl font-semibold tabular-nums',
            timeline.interruptionCount > 0 ? toneClasses('danger').text : 'text-foreground'
          )"
        >{{ timeline.interruptionCount }}</span>
        <span class="text-[11px] text-muted-foreground">barge-in proxy</span>
      </div>
      <div class="flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2">
        <span class="text-[12px] font-medium text-muted-foreground">Total span</span>
        <span class="text-xl font-semibold tabular-nums text-foreground">{{ spanLabel }}</span>
        <span class="text-[11px] text-muted-foreground">wall-clock</span>
      </div>
    </div>

    <!-- Per-turn latency mini chart (REAL) -->
    <div
      v-if="turns.length"
      class="flex flex-col gap-2"
    >
      <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Per-turn response latency ({{ turns.length }} turn{{ turns.length === 1 ? '' : 's' }})
      </p>
      <div class="flex flex-col gap-1">
        <button
          v-for="(t, i) in turns"
          :key="i"
          type="button"
          class="group flex items-center gap-2 rounded outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :title="`Turn responding at entry #${t.agentEntryIdx} · ${Math.round(t.latencyMs)}ms`"
          @click="emit('entry:select', t.agentEntryIdx)"
        >
          <span class="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">#{{ t.agentEntryIdx }}</span>
          <span class="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              class="block h-full rounded-full transition-[width]"
              :class="barTone(t.latencyMs).dot"
              :style="{ width: `${Math.max(3, (t.latencyMs / maxTurnMs) * 100)}%` }"
            />
          </span>
          <span class="w-14 shrink-0 text-right text-[12px] tabular-nums text-foreground/80">{{ Math.round(t.latencyMs) }}ms</span>
        </button>
      </div>
      <p class="text-[11px] text-muted-foreground">
        Click a turn to highlight it in the transcript.
      </p>
    </div>
  </div>
</template>
