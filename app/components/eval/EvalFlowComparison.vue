<script setup lang="ts">
// CREATED (our eval layer) — the three-DAG comparison: Call Flow vs Expected vs Actual.
/**
 * EvalFlowComparison — the showcase. Lays the THREE normalized DAGs side-by-side
 * (or one-at-a-time on narrow screens / by toggle), all rendered through the one
 * shared <FlowCanvas> so they share GHL Agent Studio's visual language:
 *
 *   1. Call Flow   (BORROWED) — agent.flow, the as-designed Agent Studio graph.
 *   2. Expected    (CREATED)  — ExpectedFlow, toggling normative ↔ per-call ideal.
 *   3. Actual      (CREATED)  — ActualFlow (executed trace), painted with the
 *                               conformance overlay from analysis.conformance
 *                               (hit / skipped / out_of_order / extra).
 *
 * Each panel is explicitly tagged BORROWED vs CREATED. A node click anywhere
 * emits `node:select` so the inspector / conformance list stay in sync; the
 * selected node is ringed across all three canvases.
 */
import { computed, ref } from 'vue'
import { Columns3, Square } from 'lucide-vue-next'
import type { ActualFlow, ExpectedFlow, FlowConformance, FlowGraph, NodeStatus } from '#shared/types'
import FlowCanvas from '~/components/flow/FlowCanvas.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

const props = defineProps<{
  /** BORROWED as-designed Call Flow (agent.flow). */
  callFlow: FlowGraph
  /** CREATED expected DAG (normative + optional per-call ideal). */
  expectedFlow: ExpectedFlow | null
  /** CREATED executed-trace DAG; null until the call has transcript entries. */
  actualFlow: ActualFlow | null
  /** Deterministic conformance — drives the Actual-DAG node overlay. */
  conformance: FlowConformance | null
  selectedNodeId?: string
}>()

const emit = defineEmits<{
  (e: 'node:select', nodeId: string): void
}>()

type View = 'side' | 'callFlow' | 'expected' | 'actual'
/** Side-by-side on wide screens; single-focus toggles for narrow / drill-in. */
const view = ref<View>('side')

/** Expected-flow layer toggle: normative (design) vs per-call (this caller). */
const expectedLayer = ref<'normative' | 'perCall'>('normative')

const hasPerCall = computed(() => Boolean(props.expectedFlow?.perCall))

const expectedGraph = computed<FlowGraph | null>(() => {
  if (!props.expectedFlow) return null
  if (expectedLayer.value === 'perCall' && props.expectedFlow.perCall) {
    return props.expectedFlow.perCall.ideal
  }
  return props.expectedFlow.normative
})

/**
 * The Actual DAG carries the conformance overlay: map each alignment's nodeId →
 * status so FlowCanvas paints hit/skipped/out_of_order/extra rings. Built only
 * from the deterministic conformance — no inference.
 */
const overlay = computed<Record<string, NodeStatus>>(() => {
  const map: Record<string, NodeStatus> = {}
  for (const n of props.conformance?.nodeAlignments ?? []) {
    map[n.nodeId] = n.status
  }
  return map
})

/** ActualFlow shares the FlowGraph shape (nodes/edges) so FlowCanvas renders it. */
const actualGraph = computed<FlowGraph | null>(() => {
  if (!props.actualFlow) return null
  return {
    versionId: `actual-${props.actualFlow.callId}`,
    agentId: props.actualFlow.agentId,
    isPublished: false,
    nodes: props.actualFlow.nodes,
    edges: props.actualFlow.edges,
    globalVariables: []
  }
})

function onNodeClick(nodeId: string) {
  emit('node:select', nodeId)
}

interface PanelKey { key: Exclude<View, 'side'> }
const panelsToShow = computed<PanelKey['key'][]>(() =>
  view.value === 'side' ? ['callFlow', 'expected', 'actual'] : [view.value]
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- View controls -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1 rounded-md border p-0.5">
        <Button
          variant="ghost"
          size="sm"
          :class="cn('h-7 gap-1.5', view === 'side' && 'bg-accent')"
          @click="view = 'side'"
        >
          <Columns3 class="size-3.5" /> Side by side
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :class="cn('h-7 gap-1.5', view === 'callFlow' && 'bg-accent')"
          @click="view = 'callFlow'"
        >
          <Square class="size-3.5" /> Call Flow
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :class="cn('h-7', view === 'expected' && 'bg-accent')"
          @click="view = 'expected'"
        >
          Expected
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :class="cn('h-7', view === 'actual' && 'bg-accent')"
          @click="view = 'actual'"
        >
          Actual
        </Button>
      </div>

      <!-- Expected layer toggle (only meaningful when Expected is visible) -->
      <div
        v-if="(view === 'side' || view === 'expected') && hasPerCall"
        class="flex items-center gap-1 rounded-md border p-0.5"
      >
        <Button
          variant="ghost"
          size="sm"
          :class="cn('h-7', expectedLayer === 'normative' && 'bg-accent')"
          @click="expectedLayer = 'normative'"
        >
          Normative
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :class="cn('h-7', expectedLayer === 'perCall' && 'bg-accent')"
          @click="expectedLayer = 'perCall'"
        >
          Per-call
        </Button>
      </div>
    </div>

    <!-- DAG grid -->
    <div
      :class="cn(
        'grid gap-3',
        view === 'side' ? 'lg:grid-cols-3' : 'grid-cols-1'
      )"
    >
      <!-- Call Flow (BORROWED) -->
      <div
        v-if="panelsToShow.includes('callFlow')"
        class="flex flex-col overflow-hidden rounded-xl border"
      >
        <div class="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
          <span class="text-sm font-semibold">Call Flow</span>
          <Badge
            variant="outline"
            class="rounded-md text-[10px] font-medium uppercase tracking-wide"
          >
            Borrowed
          </Badge>
        </div>
        <div class="h-[420px]">
          <FlowCanvas
            :graph="callFlow"
            :selected-node-id="selectedNodeId"
            @node:click="onNodeClick"
          />
        </div>
        <p class="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          As designed in HighLevel Agent Studio.
        </p>
      </div>

      <!-- Expected Flow (CREATED) -->
      <div
        v-if="panelsToShow.includes('expected')"
        class="flex flex-col overflow-hidden rounded-xl border"
      >
        <div class="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
          <span class="text-sm font-semibold">
            Expected Flow
            <span class="font-normal text-muted-foreground">· {{ expectedLayer === 'perCall' ? 'per-call' : 'normative' }}</span>
          </span>
          <Badge
            :class="cn('rounded-md border-transparent text-[10px] font-medium uppercase tracking-wide', 'bg-primary/10 text-primary')"
          >
            Created
          </Badge>
        </div>
        <div class="h-[420px]">
          <FlowCanvas
            v-if="expectedGraph"
            :graph="expectedGraph"
            :selected-node-id="selectedNodeId"
            @node:click="onNodeClick"
          />
          <div
            v-else
            class="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground"
          >
            No expected flow compiled for this agent yet.
          </div>
        </div>
        <p class="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          {{ expectedLayer === 'perCall'
            ? 'What this caller\'s intent should have traversed.'
            : 'The ideal DAG compiled from the agent design.' }}
        </p>
      </div>

      <!-- Actual Flow (CREATED) + conformance overlay -->
      <div
        v-if="panelsToShow.includes('actual')"
        class="flex flex-col overflow-hidden rounded-xl border"
      >
        <div class="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
          <span class="text-sm font-semibold">Actual Flow</span>
          <Badge
            :class="cn('rounded-md border-transparent text-[10px] font-medium uppercase tracking-wide', 'bg-primary/10 text-primary')"
          >
            Created
          </Badge>
        </div>
        <div class="h-[420px]">
          <FlowCanvas
            v-if="actualGraph"
            :graph="actualGraph"
            :overlay="overlay"
            :selected-node-id="selectedNodeId"
            @node:click="onNodeClick"
          />
          <div
            v-else
            class="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground"
          >
            No executed trace — this call has no transcript yet.
          </div>
        </div>
        <p class="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          The executed trace, colored by conformance (hit / skipped / drift / extra).
        </p>
      </div>
    </div>

    <!-- Overlay legend (only when the Actual DAG with overlay is visible) -->
    <div
      v-if="actualGraph && conformance && (view === 'side' || view === 'actual')"
      class="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground"
    >
      <span class="font-medium text-foreground">Conformance</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full ring-2 ring-success" /> Hit</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full ring-2 ring-warning" /> Skipped / out of order</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full ring-2 ring-danger" /> Extra (off-graph)</span>
    </div>
  </div>
</template>
