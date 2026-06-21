<script setup lang="ts">
import type { ExpectedFlow, FlowAlignment, NodeAlignment, NodeStatus } from '#shared/types'
import { computed } from 'vue'
import { ArrowRight, CheckCircle2, CircleSlash, MoveRight, PlusCircle, ShuffleIcon } from 'lucide-vue-next'
import { Progress } from '~/components/ui/progress'
import SectionCard from '~/components/SectionCard.vue'
import FlowDiagram from '~/components/FlowDiagram.vue'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

/**
 * FlowDrift — the call's conformance/fitness rollup + the flow graph tinted by
 * conformance + a clickable drift list that cross-highlights the cited turns.
 *
 * All status color routes through useTone() tokens (no raw emerald-/amber-/red).
 * The header conformance band, the progress bar fill/track, the status badges,
 * and the drift-row left accent all read from the same semantic scale as the
 * rest of the app.
 */
const props = defineProps<{
  flow: ExpectedFlow
  alignment: FlowAlignment
  /** Cross-highlight: the flow node currently selected on the page. */
  activeNodeId?: string | null
}>()

const emit = defineEmits<{ (e: 'selectNode', turnIdxs: number[]): void }>()

const { scoreToneSet, scoreToneName, statusTone, statusLabel } = useTone()

/* ----------------------------------------------------------------------------
 * Conformance tone — routed through the shared score band (>=80 / >=60 / <60).
 * ------------------------------------------------------------------------- */
const conformance = computed(() => props.alignment.conformanceScore)
const conformanceTone = computed(() => scoreToneSet(conformance.value))
const conformanceBandLabel = computed(() => {
  const band = scoreToneName(conformance.value)
  if (band === 'success') return 'On track'
  if (band === 'warning') return 'Some drift'
  return 'Significant drift'
})

/** Progress bar: soft track + token-matched indicator fill. */
const conformanceBar = computed(() => cn(
  conformanceTone.value.bg,
  scoreToneName(conformance.value) === 'success' && '[&_[data-slot=progress-indicator]]:bg-success',
  scoreToneName(conformance.value) === 'warning' && '[&_[data-slot=progress-indicator]]:bg-warning',
  scoreToneName(conformance.value) === 'danger' && '[&_[data-slot=progress-indicator]]:bg-danger'
))

const fitnessPct = computed(() => Math.round(props.alignment.fitness * 100))

/* ----------------------------------------------------------------------------
 * Status presentation for badges / drifted rows — icon + token badge.
 * ------------------------------------------------------------------------- */
type StatusMeta = { icon: typeof CheckCircle2 }
const STATUS_ICON: Record<NodeStatus, StatusMeta> = {
  hit: { icon: CheckCircle2 },
  skipped: { icon: CircleSlash },
  out_of_order: { icon: ShuffleIcon },
  extra: { icon: PlusCircle }
}

const LEGEND: NodeStatus[] = ['hit', 'skipped', 'out_of_order', 'extra']

/**
 * Static left-accent class per status (literal map so Tailwind emits them).
 * Mirrors the useTone tone band: hit=success, skipped/out_of_order=warning,
 * extra=danger.
 */
const STATUS_BORDER: Record<NodeStatus, string> = {
  hit: 'border-l-success',
  skipped: 'border-l-warning',
  out_of_order: 'border-l-warning',
  extra: 'border-l-danger'
}

/* Drifted nodes only: anything that isn't a clean hit and actually drifted. */
const driftedNodes = computed<NodeAlignment[]>(() =>
  props.alignment.nodeAlignments.filter(na => na.status !== 'hit' && na.driftScore > 0)
)

const hasDrift = computed(() => driftedNodes.value.length > 0)

function onNodeClick(nodeId: string) {
  const na = props.alignment.nodeAlignments.find(n => n.nodeId === nodeId)
  if (na) emit('selectNode', na.matchedTurnIdxs)
}

function onDriftRowClick(na: NodeAlignment) {
  emit('selectNode', na.matchedTurnIdxs)
}

/** Is this drift row the one currently cross-highlighted on the page? */
function isActive(na: NodeAlignment): boolean {
  return props.activeNodeId != null && na.nodeId === props.activeNodeId
}
</script>

<template>
  <SectionCard
    padding="flush"
    class="overflow-hidden"
  >
    <!-- Conformance + fitness header (tokenized band) -->
    <div class="grid grid-cols-1 divide-y border-b bg-muted/30 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
      <!-- Conformance -->
      <div class="flex flex-col gap-2 p-5">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Conformance
          </p>
          <span :class="cn('text-[12px] font-medium', conformanceTone.text)">{{ conformanceBandLabel }}</span>
        </div>
        <div class="flex items-end gap-1.5">
          <span :class="cn('text-[30px] font-semibold leading-none tabular-nums', conformanceTone.text)">{{ Math.round(conformance) }}</span>
          <span class="pb-0.5 text-sm text-muted-foreground">/ 100</span>
        </div>
        <Progress
          :model-value="conformance"
          :class="cn('h-2', conformanceBar)"
        />
      </div>

      <!-- Fitness -->
      <div class="flex flex-col gap-2 p-5">
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Process fitness
        </p>
        <div class="flex items-end gap-1.5">
          <span class="text-[30px] font-semibold leading-none tabular-nums">{{ fitnessPct }}</span>
          <span class="pb-0.5 text-sm text-muted-foreground">%</span>
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground">
          Share of the designed flow the call actually replayed.
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-5 p-5">
      <!-- The graph, tinted by conformance; cross-highlights the active node -->
      <FlowDiagram
        :flow="flow"
        :alignment="alignment"
        :active-node-id="activeNodeId"
        @node-click="onNodeClick"
      />

      <!-- Legend -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
        <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Legend</span>
        <span
          v-for="status in LEGEND"
          :key="status"
          class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <component
            :is="STATUS_ICON[status].icon"
            :class="cn('size-3.5', statusTone(status).text)"
          />
          {{ statusLabel(status) }}
        </span>
      </div>

      <!-- Drifted nodes -->
      <div class="flex flex-col gap-2.5">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">
            Drift detail
          </h3>
          <span
            v-if="hasDrift"
            class="text-xs text-muted-foreground"
          >
            {{ driftedNodes.length }} node{{ driftedNodes.length > 1 ? 's' : '' }} drifted
          </span>
        </div>

        <!-- Perfect / empty state -->
        <div
          v-if="!hasDrift"
          :class="cn('flex items-center gap-3 rounded-xl border px-4 py-5', statusTone('hit').bg, 'border-success/25')"
        >
          <span :class="cn('flex size-9 shrink-0 items-center justify-center rounded-full', statusTone('hit').badge)">
            <CheckCircle2 class="size-5" />
          </span>
          <div class="flex flex-col">
            <span class="text-sm font-medium">This call followed the designed flow.</span>
            <span class="text-xs text-muted-foreground">No skipped, out-of-order, or extra steps detected.</span>
          </div>
        </div>

        <!-- Drift rows -->
        <ul
          v-else
          class="flex flex-col gap-2"
        >
          <li
            v-for="(na, i) in driftedNodes"
            :key="na.nodeId ?? `extra-${i}`"
          >
            <button
              type="button"
              :class="cn(
                'group flex w-full items-start gap-3 rounded-lg border bg-card px-3.5 py-3 text-left outline-none',
                'border-l-4',
                STATUS_BORDER[na.status],
                'motion-safe:transition-shadow motion-safe:duration-[var(--dur)] motion-safe:ease-[var(--ease)] hover:elevation-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isActive(na) && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
              )"
              @click="onDriftRowClick(na)"
            >
              <span :class="cn('mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', statusTone(na.status).badge)">
                <component
                  :is="STATUS_ICON[na.status].icon"
                  class="size-3"
                />
                {{ statusLabel(na.status) }}
              </span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-sm font-semibold leading-snug">{{ na.label }}</span>
                <span
                  v-if="na.note"
                  class="text-xs leading-relaxed text-muted-foreground"
                >{{ na.note }}</span>
                <span
                  v-if="na.matchedTurnIdxs.length"
                  class="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary motion-safe:opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  <MoveRight class="size-3" />
                  Highlight turn{{ na.matchedTurnIdxs.length > 1 ? 's' : '' }} {{ na.matchedTurnIdxs.map(t => `#${t}`).join(', ') }}
                </span>
              </span>
              <ArrowRight class="ml-auto mt-1 size-4 shrink-0 text-muted-foreground/40 motion-safe:transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </SectionCard>
</template>
