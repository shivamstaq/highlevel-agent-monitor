<script setup lang="ts">
/**
 * CheckpointDriftView — the PRIMARY analysis output (R3).
 *
 * A directed, top-to-bottom flow of the agent's self-identified conversational
 * checkpoints. For each, it shows side-by-side what SHOULD have happened (the
 * agent-level expectation) vs what ACTUALLY happened on this call, colored by the
 * drift verdict (met / partial / missed / not applicable), with any edge-case
 * handling and clickable evidence chips that cross-highlight the transcript.
 */
import type { CheckpointReport, CheckpointStatus } from '#shared/types'
import { computed, nextTick, watch } from 'vue'
import {
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  Route,
  TriangleAlert,
  XCircle
} from 'lucide-vue-next'
import { cn } from '~/lib/utils'

const props = defineProps<{
  checkpoints: CheckpointReport[]
  /** Entry idxs currently highlighted elsewhere (paints matching evidence chips). */
  activeEntryIdxs?: number[]
  /** The checkpoint selected in the graph — rings + scrolls its card into view. */
  selectedStageId?: string | null
}>()

const emit = defineEmits<{
  (e: 'select', entryIdxs: number[]): void
  (e: 'selectCheckpoint', stageId: string): void
}>()

/** Stable DOM id for a checkpoint card (so a graph-node click can scroll to it). */
function cardId(stageId: string): string {
  return `cp-card-${stageId}`
}
/** Scroll the matching card into view when the graph selection changes. */
watch(() => props.selectedStageId, async (id) => {
  if (!id || typeof document === 'undefined') return
  await nextTick()
  const el = document.getElementById(cardId(id))
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
})

interface StatusMeta {
  label: string
  icon: unknown
  /** spine dot */
  dot: string
  /** soft badge surface */
  badge: string
  /** the "actual" panel tint + border */
  panel: string
  /** connector line color into the next node */
  line: string
}

const STATUS_META: Record<CheckpointStatus, StatusMeta> = {
  met: {
    label: 'Met',
    icon: CheckCircle2,
    dot: 'bg-success text-success-foreground',
    badge: 'bg-success-soft text-foreground',
    panel: 'border-success/30 bg-success-soft/50',
    line: 'bg-success/40'
  },
  partial: {
    label: 'Partial',
    icon: TriangleAlert,
    dot: 'bg-warning text-warning-foreground',
    badge: 'bg-warning-soft text-foreground',
    panel: 'border-warning/40 bg-warning-soft/50',
    line: 'bg-warning/40'
  },
  missed: {
    label: 'Missed',
    icon: XCircle,
    dot: 'bg-danger text-danger-foreground',
    badge: 'bg-danger-soft text-foreground',
    panel: 'border-danger/40 bg-danger-soft/50',
    line: 'bg-danger/40'
  },
  not_applicable: {
    label: 'N/A',
    icon: CircleSlash,
    dot: 'bg-muted-foreground/30 text-foreground',
    badge: 'bg-muted text-muted-foreground',
    panel: 'border-border bg-muted/30',
    line: 'bg-border'
  }
}

function meta(s: CheckpointStatus): StatusMeta {
  return STATUS_META[s]
}

const counts = computed(() => {
  const c: Record<CheckpointStatus, number> = { met: 0, partial: 0, missed: 0, not_applicable: 0 }
  for (const cp of props.checkpoints) c[cp.status]++
  return c
})

/** Applicable checkpoints (exclude N/A) for the headline fraction. */
const applicable = computed(() => props.checkpoints.filter(c => c.status !== 'not_applicable').length)
const metCount = computed(() => counts.value.met)

const activeSet = computed(() => new Set(props.activeEntryIdxs ?? []))

function onSelect(idxs: number[]) {
  if (idxs.length) emit('select', idxs)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Summary strip -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary">
        <Route class="size-3.5" />
        {{ metCount }} / {{ applicable }} checkpoints met
      </span>
      <span
        v-if="counts.partial"
        class="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-foreground"
      >
        <TriangleAlert class="size-3.5 text-warning" /> {{ counts.partial }} partial
      </span>
      <span
        v-if="counts.missed"
        class="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-[12px] font-medium text-foreground"
      >
        <XCircle class="size-3.5 text-danger" /> {{ counts.missed }} missed
      </span>
      <span
        v-if="counts.not_applicable"
        class="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
      >
        <CircleSlash class="size-3.5" /> {{ counts.not_applicable }} N/A
      </span>
    </div>

    <!-- Directed checkpoint flow -->
    <ol class="flex flex-col">
      <li
        v-for="(cp, i) in checkpoints"
        :key="cp.stageId"
        class="relative pl-9"
      >
        <!-- spine: connector line (not under the last node) -->
        <span
          v-if="i < checkpoints.length - 1"
          :class="cn('absolute left-[14px] top-7 bottom-0 w-0.5 -translate-x-1/2', meta(cp.status).line)"
          aria-hidden="true"
        />
        <!-- spine: status node -->
        <span
          :class="cn(
            'absolute left-[14px] top-3 flex size-7 -translate-x-1/2 items-center justify-center rounded-full ring-4 ring-background',
            meta(cp.status).dot
          )"
        >
          <component
            :is="meta(cp.status).icon"
            class="size-4"
          />
        </span>

        <!-- checkpoint card -->
        <div
          :id="cardId(cp.stageId)"
          :class="cn(
            'mb-3 scroll-mt-20 rounded-xl border bg-card p-3.5 elevation-1 transition-shadow duration-[var(--dur)] ease-[var(--ease)]',
            selectedStageId === cp.stageId && 'ring-2 ring-primary'
          )"
        >
          <button
            type="button"
            class="mb-2.5 flex w-full flex-wrap items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            @click="emit('selectCheckpoint', cp.stageId)"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span class="font-mono text-[11px] text-muted-foreground">{{ i + 1 }}</span>
              <h4 class="truncate text-sm font-semibold">
                {{ cp.label }}
              </h4>
              <span
                v-if="cp.obligation === 'conditional'"
                class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Conditional
              </span>
            </div>
            <span :class="cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', meta(cp.status).badge)">
              <component
                :is="meta(cp.status).icon"
                class="size-3"
              />
              {{ meta(cp.status).label }}
            </span>
          </button>

          <!-- Expected → Actual -->
          <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
            <div class="rounded-lg border border-primary/25 bg-primary/[0.05] p-2.5">
              <p class="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Expected
              </p>
              <p class="text-[13px] leading-snug text-foreground/90">
                {{ cp.expected }}
              </p>
            </div>
            <div class="hidden items-center justify-center text-muted-foreground sm:flex">
              <ArrowRight class="size-4" />
            </div>
            <div :class="cn('rounded-lg border p-2.5', meta(cp.status).panel)">
              <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Actual
              </p>
              <p class="text-[13px] leading-snug text-foreground/90">
                {{ cp.actual }}
              </p>
            </div>
          </div>

          <!-- Edge-case handling -->
          <div
            v-if="cp.edgeCaseNote"
            class="mt-2 flex items-start gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-[12px] text-muted-foreground"
          >
            <Route class="mt-0.5 size-3.5 shrink-0" />
            <span><span class="font-medium text-foreground">Edge case:</span> {{ cp.edgeCaseNote }}</span>
          </div>

          <!-- Evidence chips -->
          <div
            v-if="cp.evidenceEntryIdxs.length"
            class="mt-2 flex flex-wrap items-center gap-1.5"
          >
            <span class="text-[11px] text-muted-foreground">Evidence:</span>
            <button
              v-for="idx in cp.evidenceEntryIdxs"
              :key="idx"
              type="button"
              :class="cn(
                'rounded-md border px-1.5 py-0.5 font-mono text-[11px] outline-none transition-colors duration-[var(--dur)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                activeSet.has(idx)
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              )"
              @click="onSelect([idx])"
            >
              #{{ idx }}
            </button>
            <button
              v-if="cp.evidenceEntryIdxs.length > 1"
              type="button"
              class="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              @click="onSelect(cp.evidenceEntryIdxs)"
            >
              highlight all
            </button>
          </div>
        </div>
      </li>
    </ol>
  </div>
</template>
