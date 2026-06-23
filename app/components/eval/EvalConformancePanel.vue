<script setup lang="ts">
// CREATED (our eval layer) — deterministic flow-conformance readout.
/**
 * EvalConformancePanel — the deterministic conformance breakdown for one call:
 * the headline conformance score + process-mining fitness, the per-node
 * alignment list (hit / skipped / out_of_order / extra with drift), and any
 * drift edges (transitions the call took that the expected graph doesn't have).
 *
 * Clicking a node alignment emits `node:select` (its nodeId) so the host can
 * highlight that node across the FlowCanvas DAGs; `entry:select` surfaces the
 * first matched transcript entry idx for transcript highlighting. Pure readout
 * over analysis.conformance — no inference here.
 */
import { computed } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import type { FlowConformance } from '#shared/types'
import { Badge } from '~/components/ui/badge'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

const props = defineProps<{
  conformance: FlowConformance
  /** Highlight the alignment for this node (kept in sync with the canvas). */
  selectedNodeId?: string
}>()

const emit = defineEmits<{
  (e: 'node:select', nodeId: string): void
  (e: 'entry:select', entryIdx: number): void
}>()

const { scoreToneSet, statusTone, statusLabel, toneClasses } = useTone()

const score = computed(() => Math.round(props.conformance.conformanceScore))
const scoreTone = computed(() => scoreToneSet(score.value))
const fitnessPct = computed(() => Math.round(props.conformance.fitness * 100))

const alignments = computed(() => props.conformance.nodeAlignments)
const driftEdges = computed(() => props.conformance.driftEdges)

function onSelect(nodeId: string, matched: number[]) {
  emit('node:select', nodeId)
  const first = matched[0]
  if (first != null) emit('entry:select', first)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Headline -->
    <div class="flex flex-wrap items-end gap-6">
      <div class="flex flex-col gap-0.5">
        <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Flow adherence
        </span>
        <span :class="cn('text-3xl font-semibold leading-none tabular-nums', scoreTone.text)">
          {{ score }}
        </span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Fitness
        </span>
        <span class="text-xl font-semibold leading-none tabular-nums text-foreground">
          {{ fitnessPct }}%
        </span>
      </div>
    </div>

    <!-- Per-node alignment -->
    <div class="flex flex-col gap-2">
      <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Node alignment
      </p>
      <ul
        v-if="alignments.length"
        class="flex flex-col gap-1.5"
      >
        <li
          v-for="n in alignments"
          :key="n.nodeId"
        >
          <button
            type="button"
            :aria-pressed="selectedNodeId === n.nodeId"
            :class="cn(
              'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              selectedNodeId === n.nodeId && 'border-primary/60 ring-1 ring-primary/40'
            )"
            @click="onSelect(n.nodeId, n.matchedEntryIdxs)"
          >
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ n.displayName }}</span>
            <span
              v-if="n.driftScore > 0"
              class="shrink-0 text-[12px] tabular-nums text-muted-foreground"
            >
              {{ Math.round(n.driftScore * 100) }}% drift
            </span>
            <Badge
              :class="cn('shrink-0 rounded-full border-transparent text-[11px] font-medium', statusTone(n.status).badge)"
            >
              {{ statusLabel(n.status) }}
            </Badge>
          </button>
        </li>
      </ul>
      <p
        v-else
        class="text-sm text-muted-foreground"
      >
        No node alignment recorded for this call.
      </p>
    </div>

    <!-- Drift edges -->
    <div
      v-if="driftEdges.length"
      class="flex flex-col gap-2"
    >
      <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Off-graph transitions ({{ driftEdges.length }})
      </p>
      <ul class="flex flex-col gap-1.5">
        <li
          v-for="(e, i) in driftEdges"
          :key="i"
          :class="cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px]', toneClasses('danger').bg)"
        >
          <span class="font-mono text-foreground/80">{{ e.source }}</span>
          <ArrowRight class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="font-mono text-foreground/80">{{ e.target }}</span>
          <span
            v-if="e.reason"
            class="truncate text-muted-foreground"
          >· {{ e.reason }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
