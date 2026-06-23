<script setup lang="ts">
/**
 * IntendedFlowGraph — the unified flow-drift graph (R3).
 *
 * Renders the agent's LLM-inferred INTENDED call flow as a directed graph of
 * atomic nodes (start · say · ask · decide · do · handoff · end). When a per-call
 * `alignment` overlay is supplied, each node is painted by how THIS call tracked
 * it (on-track / drifted / skipped / not-reached) and dashed red TANGENT nodes are
 * injected wherever the agent went off the intended flow. Nodes auto-layout
 * (longest-path layering) so no stored geometry is needed. Clicking a node (or
 * tangent) selects it — the parent shows its intended-vs-actual-vs-fix detail.
 */
import type {
  FlowAlignment,
  FlowAlignmentStatus,
  InferredFlow,
  InferredFlowNodeKind
} from '#shared/types'
import { computed, watch } from 'vue'
import {
  VueFlow,
  useVueFlow,
  Position,
  MarkerType,
  Handle,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import type { Edge, EdgeProps, Node } from '@vue-flow/core'
import {
  CircleDot,
  Flag,
  GitBranch,
  Headphones,
  MessageSquare,
  ClipboardList,
  Wrench,
  Zap
} from 'lucide-vue-next'
import { cn } from '~/lib/utils'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const props = withDefaults(defineProps<{
  flow: InferredFlow
  alignment?: FlowAlignment | null
  selectedNodeId?: string | null
  /** Height of the canvas — parent-controlled so the graph can fill its column. */
  heightClass?: string
}>(), {
  heightClass: 'h-[460px]'
})

const emit = defineEmits<{
  (e: 'select', nodeId: string): void
  (e: 'select-edge', payload: { condition: string, from: string, to: string }): void
}>()

const instanceId = `iflow-${Math.random().toString(36).slice(2, 9)}`
const { setViewport, getNodes, dimensions } = useVueFlow(instanceId)

/* Node kind → icon + neutral chip color. */
const KIND_META: Record<InferredFlowNodeKind, { icon: unknown, chip: string }> = {
  start: { icon: Flag, chip: 'bg-primary/10 text-primary' },
  message: { icon: MessageSquare, chip: 'bg-muted text-muted-foreground' },
  decision: { icon: GitBranch, chip: 'bg-muted text-muted-foreground' },
  collect: { icon: ClipboardList, chip: 'bg-muted text-muted-foreground' },
  tool: { icon: Wrench, chip: 'bg-muted text-muted-foreground' },
  handoff: { icon: Headphones, chip: 'bg-muted text-muted-foreground' },
  end: { icon: CircleDot, chip: 'bg-primary/10 text-primary' }
}

/* Alignment status → border/ring + small dot color. */
const STATUS_META: Record<FlowAlignmentStatus, { bar: string, badge: string, label: string }> = {
  on_track: { bar: 'bg-success', badge: 'bg-success-soft text-foreground', label: 'On track' },
  drifted: { bar: 'bg-warning', badge: 'bg-warning-soft text-foreground', label: 'Drifted' },
  skipped: { bar: 'bg-danger', badge: 'bg-danger-soft text-foreground', label: 'Skipped' },
  not_reached: { bar: 'bg-muted-foreground/25', badge: 'bg-muted text-muted-foreground', label: 'Not reached' }
}

const statusByNode = computed(() => {
  const m = new Map<string, FlowAlignmentStatus>()
  for (const a of props.alignment?.nodeAlignments ?? []) m.set(a.nodeId, a.status)
  return m
})

/* ---- BFS layered layout (HORIZONTAL, left→right), cycle-safe ----
 * Depth advances along X (columns), nodes in a layer spread along Y (rows).
 * Tangents drop BELOW their anchor node. */
const X_GAP = 340
const Y_GAP = 132

const layout = computed(() => {
  const nodes = props.flow.nodes
  const edges = props.flow.edges
  // BFS layering from the start node — shortest distance from start, so depth is
  // bounded by the node count even when the inferred flow contains cycles (e.g.
  // re-align edges pointing back). Longest-path relaxation runs away on cycles.
  const adj = new Map<string, string[]>(nodes.map(n => [n.id, []]))
  for (const e of edges) adj.get(e.source)?.push(e.target)

  const depth = new Map<string, number>()
  const start = nodes.find(n => n.kind === 'start')?.id ?? nodes[0]?.id
  const queue: string[] = []
  if (start != null) { depth.set(start, 0); queue.push(start) }
  while (queue.length) {
    const id = queue.shift()!
    const d = depth.get(id)!
    for (const t of adj.get(id) ?? []) {
      if (!depth.has(t)) { depth.set(t, d + 1); queue.push(t) }
    }
  }
  // Any node unreachable from start lands after the deepest reached layer.
  let maxD = 0
  for (const v of depth.values()) maxD = Math.max(maxD, v)
  for (const n of nodes) {
    if (!depth.has(n.id)) { maxD += 1; depth.set(n.id, maxD) }
  }

  // Group by depth, assign centered x within each layer.
  const layers = new Map<number, string[]>()
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0
    if (!layers.has(d)) layers.set(d, [])
    layers.get(d)!.push(n.id)
  }
  const pos = new Map<string, { x: number, y: number }>()
  for (const [d, ids] of layers) {
    ids.forEach((id, i) => {
      // Horizontal: depth → x (columns); index within layer → y (rows, centered).
      pos.set(id, { x: d * X_GAP, y: (i - (ids.length - 1) / 2) * Y_GAP })
    })
  }
  return pos
})

const nodes = computed<Node[]>(() => {
  const out: Node[] = props.flow.nodes.map((n): Node => {
    const status = statusByNode.value.get(n.id)
    return {
      id: n.id,
      type: 'iflow',
      position: layout.value.get(n.id) ?? { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        kind: n.kind,
        label: n.label,
        description: n.description,
        status,
        isTangent: false,
        selected: props.selectedNodeId === n.id
      },
      draggable: false,
      connectable: false,
      selectable: true
    }
  })

  // Tangent nodes — drop BELOW their anchor node (the main flow runs horizontally).
  for (const t of props.alignment?.tangents ?? []) {
    const anchor = layout.value.get(t.afterNodeId) ?? { x: 0, y: 0 }
    out.push({
      id: t.id,
      type: 'iflow',
      position: { x: anchor.x, y: anchor.y + Y_GAP * 1.5 },
      sourcePosition: Position.Right,
      targetPosition: Position.Top,
      data: {
        kind: 'tangent',
        label: t.label,
        description: t.recommendation || t.description,
        status: undefined,
        isTangent: true,
        selected: props.selectedNodeId === t.id
      },
      draggable: false,
      connectable: false,
      selectable: true
    })
  }
  return out
})

/** Edge labels are kept SHORT (no ellipsis/box) — the full condition shows in the
 *  detail panel on click. A hard clip avoids any truncation glyph on the canvas. */
function clipLabel(s: string | undefined): string | undefined {
  if (!s) return undefined
  const t = s.trim()
  return t.length > 18 ? t.slice(0, 18) : t
}

const edges = computed<Edge[]>(() => {
  const out: Edge[] = props.flow.edges.map((e, i): Edge => {
    const cond = e.condition?.trim()
    return {
      id: `e-${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      // Main flow runs left→right: connect right handle → left handle.
      sourceHandle: 'r',
      targetHandle: 'l',
      // Conditioned edges use a custom HTML label (truncated + hover tooltip).
      type: cond ? 'cond' : 'smoothstep',
      data: cond ? { short: clipLabel(cond), full: cond } : undefined,
      markerEnd: MarkerType.ArrowClosed,
      style: { stroke: 'var(--border)', strokeWidth: 1.5 }
    }
  })
  for (const t of props.alignment?.tangents ?? []) {
    out.push({
      id: `tan-${t.id}`,
      source: t.afterNodeId,
      target: t.id,
      // Tangent drops down: anchor bottom handle → tangent top handle.
      sourceHandle: 'b',
      targetHandle: 't',
      type: 'smoothstep',
      markerEnd: MarkerType.ArrowClosed,
      animated: true,
      style: { stroke: 'var(--danger)', strokeWidth: 1.5, strokeDasharray: '5 4' }
    })
  }
  return out
})

function kindMeta(kind: string) {
  return KIND_META[kind as InferredFlowNodeKind] ?? KIND_META.message
}

/** Smooth-step geometry for a custom conditioned edge: [path, labelX, labelY]. */
function condGeo(ep: EdgeProps): [string, number, number] {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: ep.sourceX,
    sourceY: ep.sourceY,
    sourcePosition: ep.sourcePosition,
    targetX: ep.targetX,
    targetY: ep.targetY,
    targetPosition: ep.targetPosition
  })
  return [path, labelX, labelY]
}

/**
 * Default view: fit the flow's HEIGHT (+ padding) rather than its width, so the
 * left→right flow renders at a readable size and overflows horizontally (pan to
 * follow it) instead of shrinking to fit the whole width. Vertically centered,
 * anchored near the left edge.
 */
const PAD = 44
function fitHeight() {
  const dims = dimensions.value
  const ns = getNodes.value
  if (!dims?.height || !ns.length) return
  let minX = Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of ns) {
    const h = n.dimensions?.height || 64
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxY = Math.max(maxY, n.position.y + h)
  }
  const span = Math.max(1, maxY - minY)
  const zoom = Math.max(0.4, Math.min(1.4, (dims.height - PAD * 2) / span))
  setViewport({
    x: PAD - minX * zoom,
    y: (dims.height - span * zoom) / 2 - minY * zoom,
    zoom
  })
}

function scheduleFit() {
  // Two rAFs so node dimensions are measured before we compute the height fit.
  requestAnimationFrame(() => requestAnimationFrame(fitHeight))
}

function onPaneReady() {
  scheduleFit()
}

/** Click a conditioned edge → surface its FULL condition in the detail panel. */
function onEdgeClick(payload: { edge: Edge }) {
  const e = payload.edge
  const full = (e?.data as { full?: string } | undefined)?.full
  if (full) emit('select-edge', { condition: full, from: e.source, to: e.target })
}
watch(
  () => nodes.value.length + ':' + (props.alignment?.nodeAlignments.length ?? 0),
  scheduleFit
)
</script>

<template>
  <div :class="cn('w-full overflow-hidden rounded-xl border bg-muted/20', heightClass)">
    <VueFlow
      :id="instanceId"
      :nodes="nodes"
      :edges="edges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :pan-on-scroll="false"
      :zoom-on-scroll="true"
      :min-zoom="0.3"
      :max-zoom="1.8"
      @pane-ready="onPaneReady"
      @node-click="emit('select', ($event.node).id)"
      @edge-click="onEdgeClick"
    >
      <!-- Conditioned edge: truncated HTML label with a full-text hover tooltip. -->
      <template #edge-cond="ep">
        <!-- Fat interaction width so the edge LINE is easy to click anywhere. -->
        <BaseEdge
          :id="ep.id"
          :path="condGeo(ep)[0]"
          :marker-end="ep.markerEnd"
          :style="ep.style"
          :interaction-width="40"
        />
        <EdgeLabelRenderer>
          <!-- No box, but the LABEL itself is clickable (with padded hit area) so
               you don't have to find the thin line. Click → full condition panel. -->
          <button
            type="button"
            tabindex="-1"
            :style="{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${condGeo(ep)[1]}px,${condGeo(ep)[2]}px)`,
            }"
            class="pointer-events-auto cursor-pointer whitespace-nowrap bg-transparent px-2 py-1.5 text-[10px] font-medium italic text-muted-foreground outline-none transition-colors hover:text-foreground"
            @click="ep.data?.full && emit('select-edge', { condition: String(ep.data.full), from: ep.source, to: ep.target })"
          >
            {{ ep.data?.short }}
          </button>
        </EdgeLabelRenderer>
      </template>

      <template #node-iflow="np">
        <!-- A non-focusable <div> (not a <button>): selection is driven by Vue
             Flow's @node-click, and a div can't grab focus on click, so the
             browser never scrolls the focused element into view (no page jump). -->
        <div
          :class="cn(
            'w-[224px] cursor-pointer overflow-hidden rounded-lg border bg-card text-left elevation-1 transition-shadow',
            np.data.isTangent && 'border-dashed border-danger/60 bg-danger-soft/40',
            np.data.selected && 'ring-2 ring-primary'
          )"
        >
          <Handle
            id="l"
            type="target"
            :position="Position.Left"
            class="!size-1.5 !border-0 !bg-border"
          />
          <Handle
            id="t"
            type="target"
            :position="Position.Top"
            class="!size-1.5 !border-0 !bg-border"
          />
          <div class="flex items-stretch gap-0">
            <span
              v-if="np.data.status"
              :class="cn('w-1 shrink-0', STATUS_META[np.data.status as FlowAlignmentStatus].bar)"
            />
            <div class="min-w-0 flex-1 p-2.5">
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span :class="cn('flex size-5 shrink-0 items-center justify-center rounded', np.data.isTangent ? 'bg-danger-soft text-danger' : kindMeta(np.data.kind).chip)">
                    <component
                      :is="np.data.isTangent ? Zap : kindMeta(np.data.kind).icon"
                      class="size-3"
                    />
                  </span>
                  <span class="truncate text-[12.5px] font-semibold">{{ np.data.label }}</span>
                </div>
                <span
                  v-if="np.data.status"
                  :class="cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold', STATUS_META[np.data.status as FlowAlignmentStatus].badge)"
                >
                  {{ STATUS_META[np.data.status as FlowAlignmentStatus].label }}
                </span>
                <span
                  v-else-if="np.data.isTangent"
                  class="shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[9.5px] font-semibold text-danger-foreground"
                >
                  Off-script
                </span>
              </div>
              <p class="mt-0.5 line-clamp-1 text-[10.5px] leading-snug text-muted-foreground">
                <span
                  v-if="np.data.isTangent"
                  class="font-medium text-danger"
                >Re-align: </span>{{ np.data.description }}
              </p>
            </div>
          </div>
          <Handle
            id="r"
            type="source"
            :position="Position.Right"
            class="!size-1.5 !border-0 !bg-border"
          />
          <Handle
            id="b"
            type="source"
            :position="Position.Bottom"
            class="!size-1.5 !border-0 !bg-border"
          />
        </div>
      </template>

      <Background
        :gap="22"
        :size="1"
        pattern-color="var(--border)"
      />
      <Controls
        :show-interactive="false"
        position="bottom-right"
      />
    </VueFlow>
  </div>
</template>

<style scoped>
:deep(.vue-flow__attribution) {
  font-size: 9px;
  opacity: 0.4;
}
</style>
