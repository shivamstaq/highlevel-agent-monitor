<script setup lang="ts">
// CREATED (our eval layer) — the one shared DAG canvas, reused for ALL THREE flows.
/**
 * FlowCanvas — the single Vue Flow surface that renders any normalized
 * `FlowGraph`. It is reused verbatim for all three DAGs (BORROWED Call Flow /
 * CREATED Expected Flow / CREATED Actual Flow) so they share one visual
 * language — exactly mirroring how GHL Agent Studio draws a flow.
 *
 * Channels (kept orthogonal):
 *   - node TYPE  → icon + neutral type chip (FlowNodeCard / nodeMeta) echoing
 *     GHL's trigger/llm/router/action/endCall vocabulary.
 *   - conformance STATUS → an optional `overlay` map paints a colored ring +
 *     badge (hit=green, skipped/out_of_order=amber, extra=red) via useTone tokens.
 *
 * Positions come straight from `node.position` (GHL `uiNodes` geometry, 1:1).
 * Edges carry their label/condition. Emits `node:click` with the nodeId.
 *
 * Props:
 *   graph          FlowGraph        the DAG to render (required)
 *   overlay?       Record<id,status> per-node conformance coloring
 *   selectedNodeId? string          highlight + ring this node
 *   editable?      boolean          allow drag/connect (default false = read-only)
 */
import { computed, watch } from 'vue'
import { VueFlow, useVueFlow, Position, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import type { Edge, Node } from '@vue-flow/core'
import type { FlowGraph, FlowNodeData, FlowNodeType, NodeStatus } from '#shared/types'
import FlowNodeCard from './nodes/FlowNodeCard.vue'

// Vue Flow's own styles + the two plugin stylesheets. Imported here so any page
// that uses <FlowCanvas> gets them without extra wiring.
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

interface NodePayload {
  flowType: FlowNodeType
  flowData: FlowNodeData
  status?: NodeStatus
  selected?: boolean
}

const props = withDefaults(defineProps<{
  graph: FlowGraph
  overlay?: Record<string, NodeStatus>
  selectedNodeId?: string
  editable?: boolean
}>(), {
  overlay: undefined,
  selectedNodeId: undefined,
  editable: false
})

const emit = defineEmits<{
  (e: 'node:click', nodeId: string): void
}>()

// A unique id per instance so three canvases can coexist on one page without
// Vue Flow store collisions (id is required when multiple instances mount).
const instanceId = `flow-${Math.random().toString(36).slice(2, 9)}`
const { fitView } = useVueFlow(instanceId)

/** Map our normalized FlowNode[] → Vue Flow Node[] (custom `flowCard` type). */
const nodes = computed<Node[]>(() =>
  props.graph.nodes.map((n): Node => ({
    id: n.id,
    type: 'flowCard',
    position: n.position,
    // Top→bottom flow direction (matches captured geometry).
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      payload: {
        flowType: n.type,
        flowData: n.data,
        status: props.overlay?.[n.id],
        selected: props.selectedNodeId === n.id
      } satisfies NodePayload
    },
    draggable: props.editable,
    connectable: props.editable,
    selectable: true
  }))
)

/** Map our normalized FlowEdge[] → Vue Flow Edge[] with labels/markers. */
const edges = computed<Edge[]>(() =>
  props.graph.edges.map((e): Edge => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: false,
    markerEnd: MarkerType.ArrowClosed,
    labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.9 },
    labelStyle: { fontSize: '10px', fill: 'var(--muted-foreground)' },
    style: { stroke: 'var(--border)', strokeWidth: 1.5 }
  }))
)

function onNodeClick(nodeId: string) {
  emit('node:click', nodeId)
}

// Refit whenever the graph identity changes (e.g. toggling Call/Expected/Actual,
// or normative ↔ per-call) so a freshly-swapped DAG is always framed.
watch(
  () => props.graph.versionId + ':' + props.graph.nodes.length + ':' + props.graph.edges.length,
  () => {
    // nextTick-ish: Vue Flow needs the new nodes laid out before fitting.
    requestAnimationFrame(() => fitView({ padding: 0.18, duration: 200 }))
  }
)

function onPaneReady() {
  fitView({ padding: 0.18 })
}
</script>

<template>
  <div class="size-full">
    <VueFlow
      :id="instanceId"
      :nodes="nodes"
      :edges="edges"
      :nodes-draggable="editable"
      :nodes-connectable="editable"
      :elements-selectable="true"
      :pan-on-scroll="false"
      :zoom-on-scroll="true"
      :min-zoom="0.2"
      :max-zoom="1.75"
      :default-viewport="{ x: 0, y: 0, zoom: 0.8 }"
      fit-view-on-init
      class="bg-muted/30"
      @pane-ready="onPaneReady"
      @node-click="onNodeClick(($event.node).id)"
    >
      <template #node-flowCard="nodeProps">
        <FlowNodeCard :data="nodeProps.data" />
      </template>

      <Background
        :gap="22"
        :size="1"
        pattern-color="var(--border)"
      />
      <Controls
        :show-interactive="editable"
        position="bottom-right"
      />

      <!-- Empty-state overlay when the DAG has no nodes (e.g. unanalyzed call). -->
      <div
        v-if="!nodes.length"
        class="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <p class="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
          No flow to display
        </p>
      </div>
    </VueFlow>
  </div>
</template>

<style scoped>
/* Keep Vue Flow's attribution from overlapping our controls; harmless if absent. */
:deep(.vue-flow__attribution) {
  font-size: 9px;
  opacity: 0.4;
}
</style>
