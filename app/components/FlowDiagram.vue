<script setup lang="ts">
import type { ExpectedFlow, FlowAlignment, FlowNode, FlowNodeKind, NodeAlignment, NodeStatus } from '#shared/types'
import { computed } from 'vue'
import type {
  Flag } from 'lucide-vue-next'
import {
  CheckCircle2,
  Handshake,
  HandHelping,
  ListChecks,
  MessageSquare,
  ShieldQuestion,
  Target,
  Zap
} from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

/**
 * FlowDiagram — the agent's expected call flow as a vertical spine of node
 * cards with conditional branches offset to the right.
 *
 * Color discipline (W33): the node KIND is shown by icon + label in ONE neutral
 * chip — no kind rainbow. The only color on the diagram is conformance STATUS
 * (hit / skipped / out-of-order / extra), routed through useTone() so it agrees
 * with the rest of the app and lets the timeline stay the color hero.
 *
 * Layout (W11): nodes get vertical room; node titles wrap to two lines
 * (line-clamp-2) with a title attribute fallback; branch cards are width-bounded
 * so spine + branch never exceed the track; conditional edge-condition labels
 * sit on their own band beside the branch lane so they never collide with cards
 * or with each other.
 */
const props = defineProps<{
  flow: ExpectedFlow
  alignment?: FlowAlignment | null
  activeNodeId?: string | null
  /** When false, render non-interactive (no dead button affordance). */
  interactive?: boolean
}>()

const emit = defineEmits<{ (e: 'nodeClick', nodeId: string): void }>()

const { statusTone, statusLabel } = useTone()

/** Interactive only when a handler can act — defaults on if a listener exists. */
const isInteractive = computed(() => props.interactive ?? true)

/* ----------------------------------------------------------------------------
 * Kind metadata — icon + label only. Single neutral chip (no rainbow).
 * ------------------------------------------------------------------------- */
type KindMeta = { label: string, icon: typeof Flag }

const KIND_META: Record<FlowNodeKind, KindMeta> = {
  greeting: { label: 'Greeting', icon: MessageSquare },
  intent: { label: 'Intent', icon: Target },
  qualify: { label: 'Qualify', icon: ShieldQuestion },
  collect: { label: 'Collect', icon: ListChecks },
  confirm: { label: 'Confirm', icon: CheckCircle2 },
  objection: { label: 'Objection', icon: HandHelping },
  action: { label: 'Action', icon: Zap },
  close: { label: 'Close', icon: Handshake }
}

function kindMeta(kind: FlowNodeKind): KindMeta {
  return KIND_META[kind]
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

function statusOf(nodeId: string): NodeAlignment | undefined {
  return alignmentByNodeId.value.get(nodeId)
}

/**
 * Status -> static left-accent class. Kept as a literal map (not string-built)
 * so Tailwind's static scanner emits these border utilities. Mirrors the
 * tone band in useTone (hit=success, skipped/out_of_order=warning, extra=danger).
 */
const STATUS_BORDER: Record<NodeStatus, string> = {
  hit: 'border-l-success',
  skipped: 'border-l-warning',
  out_of_order: 'border-l-warning',
  extra: 'border-l-danger'
}

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
  for (const n of nodes) {
    if (!seen.has(n.id)) result.push(n.id)
  }
  return result.map(id => byId.get(id)!).filter(Boolean)
})

/* ----------------------------------------------------------------------------
 * Geometry — vertical spine of cards. Conditional (expected:false) nodes are
 * offset to the right lane. Generous ROW_H gives every node room and keeps the
 * SVG connectors from crossing card text. SVG overlay is drawn in viewBox units
 * (x = 0..100, y in px) so it's SSR-safe with no DOM measuring.
 * ------------------------------------------------------------------------- */
const ROW_H = 104 // px reserved per row (card + vertical gap) — roomy
const CARD_H = 68 // px nominal card height used for connector anchoring
const VB_W = 100 // viewBox width units

// Lane geometry in viewBox x-units. Branch lane sits clearly right of the spine,
// with a dedicated condition-label band between the two lanes.
const SPINE_X = 30 // x of main-spine card connector anchor
const BRANCH_X = 74 // x of conditional card connector anchor

const layout = computed(() => {
  const rows = ordered.value.map((node, i) => {
    const onSpine = node.expected
    return {
      node,
      row: i,
      x: onSpine ? SPINE_X : BRANCH_X,
      yPx: i * ROW_H,
      yCenter: i * ROW_H + CARD_H / 2
    }
  })
  const rowById = new Map(rows.map(r => [r.node.id, r]))
  return { rows, rowById }
})

const totalHeightPx = computed(() => Math.max(layout.value.rows.length * ROW_H, ROW_H))

/* Edge paths in viewBox units (x = 0..100, y in px to match container height). */
const edgePaths = computed(() => {
  const { rowById } = layout.value
  const paths: { d: string, condition?: string, labelX: number, labelY: number, branch: boolean, key: string }[] = []
  for (const e of props.flow.edges) {
    const a = rowById.get(e.from)
    const b = rowById.get(e.to)
    if (!a || !b) continue
    const x1 = a.x
    const y1 = a.yCenter + CARD_H / 2
    const x2 = b.x
    const y2 = b.yCenter - CARD_H / 2
    const midY = (y1 + y2) / 2
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
    const branch = x1 !== x2
    paths.push({
      d,
      condition: e.condition,
      // Condition labels for branch edges hug the branch anchor x so they sit in
      // their own band; straight-spine edges centre on the spine.
      labelX: branch ? (Math.min(x1, x2) + Math.max(x1, x2)) / 2 : x1,
      labelY: midY,
      branch,
      key: `${e.from}__${e.to}`
    })
  }
  return paths
})

const conditionLabels = computed(() => edgePaths.value.filter(e => e.condition))

function onClick(id: string) {
  if (isInteractive.value) emit('nodeClick', id)
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
          :stroke-width="p.branch ? 0.5 : 0.6"
          :stroke-dasharray="p.branch ? '1.4 1.4' : undefined"
          vector-effect="non-scaling-stroke"
          marker-end="url(#flow-arrow)"
        />
      </svg>

      <!-- Edge condition labels (HTML so text stays crisp / non-stretched).
           Each sits centred on its edge mid-point; max-width + truncation keep
           them from overlapping neighbours or node cards. -->
      <div
        v-for="p in conditionLabels"
        :key="`lbl-${p.key}`"
        class="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
        :style="{ left: `${p.labelX}%`, top: `${p.labelY}px` }"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <span
              class="pointer-events-auto block max-w-[8.5rem] cursor-default truncate rounded-full border border-border bg-background/95 px-2 py-0.5 text-[11px] font-medium text-muted-foreground elevation-1 backdrop-blur-sm"
              :title="p.condition"
            >
              {{ p.condition }}
            </span>
          </TooltipTrigger>
          <TooltipContent class="max-w-xs text-xs">
            <span class="font-medium">Branch when:</span> {{ p.condition }}
          </TooltipContent>
        </Tooltip>
      </div>

      <!-- Node cards -->
      <div
        v-for="item in layout.rows"
        :key="item.node.id"
        class="absolute z-20"
        :style="{
          top: `${item.yPx}px`,
          left: item.node.expected ? '0%' : 'auto',
          right: item.node.expected ? 'auto' : '0%',
          width: item.node.expected ? 'min(54%, 24rem)' : 'min(46%, 21rem)'
        }"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <component
              :is="isInteractive ? 'button' : 'div'"
              :type="isInteractive ? 'button' : undefined"
              :class="cn(
                'group flex w-full items-start gap-3 rounded-xl border bg-card px-3.5 py-3 text-left outline-none elevation-1',
                'border-l-4 border-l-border',
                isInteractive && 'cursor-pointer motion-safe:transition-shadow motion-safe:duration-[var(--dur)] motion-safe:ease-[var(--ease)] hover:elevation-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                !item.node.expected && 'border-dashed',
                statusOf(item.node.id) && STATUS_BORDER[statusOf(item.node.id)!.status],
                activeNodeId === item.node.id && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
              )"
              @click="onClick(item.node.id)"
            >
              <!-- single neutral kind chip: icon only -->
              <span class="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <component
                  :is="kindMeta(item.node.kind).icon"
                  class="size-4"
                />
              </span>

              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="flex flex-wrap items-center gap-1.5">
                  <span class="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {{ kindMeta(item.node.kind).label }}
                  </span>
                  <span
                    v-if="!item.node.expected"
                    class="rounded-full border border-dashed border-border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Conditional
                  </span>
                </span>
                <span
                  class="line-clamp-2 text-sm font-semibold leading-snug"
                  :title="item.node.label"
                >{{ item.node.label }}</span>
              </span>

              <!-- status dot via useTone -->
              <span
                v-if="statusOf(item.node.id)"
                :class="cn('mt-0.5 size-2.5 shrink-0 rounded-full ring-2 ring-background', statusTone(statusOf(item.node.id)!.status).dot)"
                :aria-label="statusLabel(statusOf(item.node.id)!.status)"
              />
            </component>
          </TooltipTrigger>
          <TooltipContent class="max-w-xs">
            <div class="flex flex-col gap-1">
              <span class="font-medium">{{ item.node.label }}</span>
              <span class="text-xs text-muted-foreground">{{ kindMeta(item.node.kind).label }} · {{ item.node.expected ? 'always expected' : 'conditional branch' }}</span>
              <span
                v-if="statusOf(item.node.id)"
                class="text-xs"
              >
                Status: {{ statusLabel(statusOf(item.node.id)!.status) }}
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
