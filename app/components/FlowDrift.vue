<script setup lang="ts">
import type { ExpectedFlow, FlowAlignment, NodeAlignment, NodeStatus } from '#shared/types'
import { computed } from 'vue'
import { ArrowRight, CheckCircle2, CircleSlash, MoveRight, PlusCircle, ShuffleIcon } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Progress } from '~/components/ui/progress'
import FlowDiagram from '~/components/FlowDiagram.vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  flow: ExpectedFlow
  alignment: FlowAlignment
}>()

const emit = defineEmits<{ (e: 'selectNode', turnIdxs: number[]): void }>()

/* ----------------------------------------------------------------------------
 * Score tone — matches the app: >=80 emerald, 60-79 amber, <60 red.
 * ------------------------------------------------------------------------- */
const scoreTone = computed(() => {
  const s = props.alignment.conformanceScore
  if (s >= 80) {
    return {
      text: 'text-emerald-600 dark:text-emerald-400',
      // Statically-present arbitrary variants so Tailwind v4 extracts them.
      bar: 'bg-emerald-500/15 [&_[data-slot=progress-indicator]]:bg-emerald-500',
      label: 'On track'
    }
  }
  if (s >= 60) {
    return {
      text: 'text-amber-600 dark:text-amber-400',
      bar: 'bg-amber-500/15 [&_[data-slot=progress-indicator]]:bg-amber-500',
      label: 'Some drift'
    }
  }
  return {
    text: 'text-red-600 dark:text-red-400',
    bar: 'bg-red-500/15 [&_[data-slot=progress-indicator]]:bg-red-500',
    label: 'Significant drift'
  }
})

const fitnessPct = computed(() => Math.round(props.alignment.fitness * 100))

/* ----------------------------------------------------------------------------
 * Status presentation for badges / drifted rows.
 * ------------------------------------------------------------------------- */
type StatusMeta = { label: string, icon: typeof CheckCircle2, badge: string }
const STATUS_META: Record<NodeStatus, StatusMeta> = {
  hit: { label: 'Hit', icon: CheckCircle2, badge: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' },
  skipped: { label: 'Skipped', icon: CircleSlash, badge: 'bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25' },
  out_of_order: { label: 'Out of order', icon: ShuffleIcon, badge: 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25' },
  extra: { label: 'Extra', icon: PlusCircle, badge: 'bg-slate-500/12 text-slate-600 dark:text-slate-400 border-slate-500/25' }
}

const LEGEND: { status: NodeStatus }[] = [
  { status: 'hit' }, { status: 'skipped' }, { status: 'out_of_order' }, { status: 'extra' }
]

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
</script>

<template>
  <Card class="gap-0 overflow-hidden py-0">
    <CardHeader class="gap-0 border-b bg-muted/30 p-0">
      <div class="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <!-- Conformance -->
        <div class="flex flex-col gap-2 p-5">
          <div class="flex items-center justify-between">
            <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Conformance
            </CardTitle>
            <span :class="cn('text-[11px] font-medium', scoreTone.text)">{{ scoreTone.label }}</span>
          </div>
          <div class="flex items-end gap-1.5">
            <span :class="cn('text-4xl font-semibold leading-none tabular-nums', scoreTone.text)">{{ Math.round(alignment.conformanceScore) }}</span>
            <span class="pb-0.5 text-sm text-muted-foreground">/ 100</span>
          </div>
          <Progress
            :model-value="alignment.conformanceScore"
            :class="cn('h-2', scoreTone.bar)"
          />
        </div>

        <!-- Fitness -->
        <div class="flex flex-col gap-2 p-5">
          <CardTitle class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Process fitness
          </CardTitle>
          <div class="flex items-end gap-1.5">
            <span class="text-4xl font-semibold leading-none tabular-nums">{{ fitnessPct }}</span>
            <span class="pb-0.5 text-sm text-muted-foreground">%</span>
          </div>
          <p class="text-xs leading-relaxed text-muted-foreground">
            Share of the designed flow the call actually replayed.
          </p>
        </div>
      </div>
    </CardHeader>

    <CardContent class="flex flex-col gap-5 p-5">
      <!-- The graph, tinted by conformance -->
      <FlowDiagram
        :flow="flow"
        :alignment="alignment"
        @node-click="onNodeClick"
      />

      <!-- Legend -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
        <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Legend</span>
        <span
          v-for="l in LEGEND"
          :key="l.status"
          class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <component
            :is="STATUS_META[l.status].icon"
            :class="cn('size-3.5', STATUS_META[l.status].badge.split(' ').find(c => c.startsWith('text-')))"
          />
          {{ STATUS_META[l.status].label }}
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
          class="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-5"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
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
              class="group flex w-full items-start gap-3 rounded-lg border bg-card px-3.5 py-3 text-left transition-all hover:border-foreground/20 hover:shadow-sm"
              @click="onDriftRowClick(na)"
            >
              <span :class="cn('mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_META[na.status].badge)">
                <component
                  :is="STATUS_META[na.status].icon"
                  class="size-3"
                />
                {{ STATUS_META[na.status].label }}
              </span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-sm font-semibold leading-snug">{{ na.label }}</span>
                <span
                  v-if="na.note"
                  class="text-xs leading-relaxed text-muted-foreground"
                >{{ na.note }}</span>
                <span
                  v-if="na.matchedTurnIdxs.length"
                  class="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <MoveRight class="size-3" />
                  Highlight turn{{ na.matchedTurnIdxs.length > 1 ? 's' : '' }} {{ na.matchedTurnIdxs.map(t => `#${t}`).join(', ') }}
                </span>
              </span>
              <ArrowRight class="ml-auto mt-1 size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </button>
          </li>
        </ul>
      </div>
    </CardContent>
  </Card>
</template>
