<script setup lang="ts">
import type { ExpectedFlow, FlowAlignment, FlowNode, FlowNodeKind, NodeAlignment, NodeStatus } from '#shared/types'
import { computed } from 'vue'
import type {
  Flag } from 'lucide-vue-next'
import {
  CheckCircle2,
  CircleSlash,
  HandHelping,
  Handshake,
  ListChecks,
  MessageSquare,
  ShieldQuestion,
  Sparkles,
  Target,
  Zap
} from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'

const props = defineProps<{
  flow: ExpectedFlow
  alignment?: FlowAlignment | null
  activeNodeId?: string | null
}>()

const emit = defineEmits<{ (e: 'nodeClick', nodeId: string): void }>()

/* ----------------------------------------------------------------------------
 * Kind metadata — each flow-node kind gets a distinct, tasteful hue + icon.
 * ------------------------------------------------------------------------- */
type KindMeta = { label: string, icon: typeof Flag, chip: string, dot: string }

const KIND_META: Record<FlowNodeKind, KindMeta> = {
  greeting: { label: 'Greeting', icon: MessageSquare, chip: 'bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/25', dot: 'bg-sky-500' },
  intent: { label: 'Intent', icon: Target, chip: 'bg-violet-500/12 text-violet-600 dark:text-violet-400 border-violet-500/25', dot: 'bg-violet-500' },
  qualify: { label: 'Qualify', icon: ShieldQuestion, chip: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 border-indigo-500/25', dot: 'bg-indigo-500' },
  collect: { label: 'Collect', icon: ListChecks, chip: 'bg-teal-500/12 text-teal-600 dark:text-teal-400 border-teal-500/25', dot: 'bg-teal-500' },
  confirm: { label: 'Confirm', icon: CheckCircle2, chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25', dot: 'bg-emerald-500' },
  objection: { label: 'Objection', icon: HandHelping, chip: 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25', dot: 'bg-amber-500' },
  action: { label: 'Action', icon: Zap, chip: 'bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/25', dot: 'bg-fuchsia-500' },
  close: { label: 'Close', icon: Handshake, chip: 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/25', dot: 'bg-rose-500' }
}

function kindMeta(kind: FlowNodeKind): KindMeta {
  return KIND_META[kind]
}

/* ----------------------------------------------------------------------------
 * Status metadata — conformance accent applied when an alignment is present.
 * ------------------------------------------------------------------------- */
type StatusMeta = { label: string, accent: string, dot: string, icon: typeof CheckCircle2 }

const STATUS_META: Record<NodeStatus, StatusMeta> = {
  hit: { label: 'Hit', accent: 'border-l-emerald-500', dot: 'bg-emerald-500', icon: CheckCircle2 },
  skipped: { label: 'Skipped', accent: 'border-l-red-500', dot: 'bg-red-500', icon: CircleSlash },
  out_of_order: { label: 'Out of order', accent: 'border-l-amber-500', dot: 'bg-amber-500', icon: Sparkles },
  extra: { label: 'Extra', accent: 'border-l-slate-400', dot: 'bg-slate-400', icon: Sparkles }
}

/* ----------------------------------------------------------------------------
 * Alignment lookup — by node id (extras have no nodeId and aren't tinted here).
 * ------------------------------------------------------------------------- */
const alignmentByNodeId = computed(() => {
  const m = new Map<string, NodeAlignment>()
  for (const na of props.alignment?.nodeAlignments ?? []) {
    if (na.nodeId) m.set(na.nodeId, na)
  }
  return m
})

/* ----------------------------------------------------------------------------
 * Topological ordering — Kahn's algorithm, stable fallback to nodes[] order.
 * ------------------------------------------------------------------------- */
const ordered = computed<FlowNode[]>(() => {
  const nodes = props.flow.nodes
  const byId = new Map(nodes.map(n => [n.id, n]))
  const indegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    indegree.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const e of props.flow.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    adj.get(e.from)!.push(e.to)
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1)
  }
  // Seed queue in original node order to keep layout deterministic + stable.
  const queue = nodes.filter(n => (indegree.get(n.id) ?? 0) === 0).map(n => n.id)
  const result: string[] = []
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1
      indegree.set(next, d)
      if (d <= 0 && !seen.has(next)) queue.push(next)
    }
  }
  // Append any nodes left out by a cycle, preserving original order.
  for (const n of nodes) {
    if (!seen.has(n.id)) result.push(n.id)
  }
  return result.map(id => byId.get(id)!).filter(Boolean)
})

/* ----------------------------------------------------------------------------
 * Geometry — vertical spine of cards; conditional (expected:false) nodes are
 * offset to the right. SVG edges are drawn in a viewBox-scaled overlay behind
 * the cards using row index -> y-center math (SSR-safe, no DOM measuring).
 * ------------------------------------------------------------------------- */
const ROW_H = 92 // px reserved per row (card + vertical gap)
const CARD_H = 64 // px nominal card height used for connector anchoring
const VB_W = 100 // viewBox width units
const SPINE_X = 33 // x of main-spine card centers (viewBox units)
const BRANCH_X = 70 // x of conditional card centers (viewBox units)

const layout = computed(() => {
  const rows = ordered.value.map((node, i) => {
    const onSpine = node.expected
    return {
      node,
      row: i,
      x: onSpine ? SPINE_X : BRANCH_X,
      yPx: i * ROW_H,
      yUnit: i * ROW_H + CARD_H / 2
    }
  })
  const rowById = new Map(rows.map(r => [r.node.id, r]))
  return { rows, rowById }
})

const totalHeightPx = computed(() => Math.max(layout.value.rows.length * ROW_H, ROW_H))

/* Edge paths in viewBox units (x = 0..100, y in px to match container height). */
const edgePaths = computed(() => {
  const { rowById } = layout.value
  const paths: { d: string, condition?: string, labelX: number, labelY: number, key: string }[] = []
  for (const e of props.flow.edges) {
    const a = rowById.get(e.from)
    const b = rowById.get(e.to)
    if (!a || !b) continue
    const x1 = a.x
    const y1 = a.yUnit + CARD_H / 2
    const x2 = b.x
    const y2 = b.yUnit - CARD_H / 2
    const midY = (y1 + y2) / 2
    // Smooth cubic; vertical control points for a clean spine, horizontal pull
    // when the edge crosses to/from a branch lane.
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
    paths.push({
      d,
      condition: e.condition,
      labelX: (x1 + x2) / 2,
      labelY: midY,
      key: `${e.from}__${e.to}`
    })
  }
  return paths
})

function statusOf(nodeId: string): NodeAlignment | undefined {
  return alignmentByNodeId.value.get(nodeId)
}

function onClick(id: string) {
  emit('nodeClick', id)
}
</script>

<template>
  <TooltipProvider :delay-duration="120">
    <div
      class="relative w-full"
      :style="{ height: `${totalHeightPx}px` }"
    >
      <!-- Edge overlay: viewBox scales x to container width; y is px-locked. -->
      <svg
        class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        :viewBox="`0 0 ${VB_W} ${totalHeightPx}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              class="fill-border"
            />
          </marker>
        </defs>
        <path
          v-for="p in edgePaths"
          :key="p.key"
          :d="p.d"
          fill="none"
          class="stroke-border"
          stroke-width="0.6"
          vector-effect="non-scaling-stroke"
          marker-end="url(#flow-arrow)"
        />
      </svg>

      <!-- Edge condition labels (HTML so text stays crisp / non-stretched). -->
      <div
        v-for="p in edgePaths.filter(e => e.condition)"
        :key="`lbl-${p.key}`"
        class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
        :style="{ left: `${p.labelX}%`, top: `${p.labelY}px` }"
      >
        <span class="rounded-full border border-border/70 bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
          {{ p.condition }}
        </span>
      </div>

      <!-- Node cards -->
      <div
        v-for="item in layout.rows"
        :key="item.node.id"
        class="absolute z-20"
        :style="{
          top: `${item.yPx}px`,
          left: item.node.expected ? '4%' : 'auto',
          right: item.node.expected ? 'auto' : '2%',
          width: item.node.expected ? '58%' : '52%'
        }"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              :class="cn(
                'group flex w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left shadow-sm outline-none transition-all',
                'border-l-4 border-l-border/40 hover:shadow-md hover:border-foreground/20',
                !item.node.expected && 'border-dashed',
                statusOf(item.node.id) && STATUS_META[statusOf(item.node.id)!.status].accent,
                activeNodeId === item.node.id && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
              )"
              @click="onClick(item.node.id)"
            >
              <span :class="cn('flex size-8 shrink-0 items-center justify-center rounded-lg border', kindMeta(item.node.kind).chip)">
                <component
                  :is="kindMeta(item.node.kind).icon"
                  class="size-4"
                />
              </span>

              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="flex items-center gap-1.5">
                  <span :class="cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', kindMeta(item.node.kind).chip)">
                    {{ kindMeta(item.node.kind).label }}
                  </span>
                  <span
                    v-if="!item.node.expected"
                    class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Conditional
                  </span>
                </span>
                <span class="truncate text-sm font-semibold leading-snug">{{ item.node.label }}</span>
              </span>

              <span
                v-if="statusOf(item.node.id)"
                :class="cn('ml-auto size-2.5 shrink-0 rounded-full ring-2 ring-background', STATUS_META[statusOf(item.node.id)!.status].dot)"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent class="max-w-xs">
            <div class="flex flex-col gap-1">
              <span class="font-medium">{{ item.node.label }}</span>
              <span class="text-xs text-muted-foreground">{{ kindMeta(item.node.kind).label }} · {{ item.node.expected ? 'always expected' : 'conditional branch' }}</span>
              <span
                v-if="statusOf(item.node.id)"
                class="text-xs"
              >
                Status: {{ STATUS_META[statusOf(item.node.id)!.status].label }}
                <template v-if="statusOf(item.node.id)!.note"> — {{ statusOf(item.node.id)!.note }}</template>
              </span>
              <span
                v-if="item.node.branchConditions.length"
                class="text-xs text-muted-foreground"
              >
                When: {{ item.node.branchConditions.join(', ') }}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
</template>
