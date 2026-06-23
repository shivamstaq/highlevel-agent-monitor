<script setup lang="ts">
/**
 * CheckpointFlowGraph — a directed-acyclic graph (Vue Flow) that maps the agent's
 * COMPLETE EXPECTED conversational flow (every checkpoint, in order, with what it
 * SHOULD accomplish) and overlays this call's drift on top: each node is colored
 * by its verdict so on-track steps (met) read affirmatively and drifted steps
 * (partial / missed) are flagged; conditional steps that didn't apply show as N/A.
 * Pannable / zoomable / clickable — clicking a node selects it (parent scrolls to
 * its detail card + cross-highlights the transcript). The visual companion to the
 * detailed expected-vs-actual card flow.
 */
import type { CheckpointReport, CheckpointStatus } from '#shared/types'
import { computed, watch } from 'vue'
import { VueFlow, useVueFlow, Position, MarkerType, Handle } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import type { Edge, Node } from '@vue-flow/core'
import { CheckCircle2, CircleSlash, TriangleAlert, XCircle } from 'lucide-vue-next'
import { cn } from '~/lib/utils'

// Vue Flow styles (deduped if another canvas already imported them).
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const props = defineProps<{
  checkpoints: CheckpointReport[]
  selectedStageId?: string | null
}>()

const emit = defineEmits<{ (e: 'select', stageId: string): void }>()

const instanceId = `cpflow-${Math.random().toString(36).slice(2, 9)}`
const { fitView } = useVueFlow(instanceId)

interface CpNodeMeta {
  icon: unknown
  badge: string
  ring: string
  bar: string
  label: string
}

const STATUS: Record<CheckpointStatus, CpNodeMeta> = {
  met: { icon: CheckCircle2, badge: 'bg-success-soft text-foreground', ring: 'ring-success/50', bar: 'bg-success', label: 'Met' },
  partial: { icon: TriangleAlert, badge: 'bg-warning-soft text-foreground', ring: 'ring-warning/50', bar: 'bg-warning', label: 'Partial' },
  missed: { icon: XCircle, badge: 'bg-danger-soft text-foreground', ring: 'ring-danger/50', bar: 'bg-danger', label: 'Missed' },
  not_applicable: { icon: CircleSlash, badge: 'bg-muted text-muted-foreground', ring: 'ring-border', bar: 'bg-muted-foreground/30', label: 'N/A' }
}

function meta(s: CheckpointStatus): CpNodeMeta {
  return STATUS[s]
}

/** Vertical DAG: one node per checkpoint, stacked top→down. */
const nodes = computed<Node[]>(() =>
  props.checkpoints.map((cp, i): Node => ({
    id: cp.stageId,
    type: 'cp',
    position: { x: 0, y: i * 132 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: { cp, index: i, selected: props.selectedStageId === cp.stageId },
    draggable: false,
    connectable: false,
    selectable: true
  }))
)

const edges = computed<Edge[]>(() =>
  props.checkpoints.slice(1).map((cp, i): Edge => {
    const prev = props.checkpoints[i]!
    return {
      id: `${prev.stageId}->${cp.stageId}`,
      source: prev.stageId,
      target: cp.stageId,
      type: 'smoothstep',
      markerEnd: MarkerType.ArrowClosed,
      style: { stroke: 'var(--border)', strokeWidth: 1.5 }
    }
  })
)

function onPaneReady() {
  fitView({ padding: 0.2 })
}

watch(
  () => props.checkpoints.map(c => c.stageId + c.status).join('|'),
  () => requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }))
)
</script>

<template>
  <div class="h-[440px] w-full overflow-hidden rounded-xl border bg-muted/20">
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
      :max-zoom="1.5"
      fit-view-on-init
      @pane-ready="onPaneReady"
      @node-click="emit('select', ($event.node).id)"
    >
      <template #node-cp="np">
        <button
          type="button"
          :class="cn(
            'w-[260px] rounded-lg border bg-card p-0 text-left elevation-1 outline-none transition-shadow',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            np.data.selected && 'ring-2 ring-primary',
            !np.data.selected && 'ring-1 ' + meta(np.data.cp.status).ring
          )"
        >
          <Handle
            type="target"
            :position="Position.Top"
            class="!size-1.5 !border-0 !bg-border"
          />
          <div class="flex items-stretch gap-0 overflow-hidden rounded-lg">
            <span :class="cn('w-1 shrink-0', meta(np.data.cp.status).bar)" />
            <div class="min-w-0 flex-1 p-2.5">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="font-mono text-[10px] text-muted-foreground">{{ np.data.index + 1 }}</span>
                  <span class="truncate text-[13px] font-semibold">{{ np.data.cp.label }}</span>
                </div>
                <span :class="cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', meta(np.data.cp.status).badge)">
                  <component
                    :is="meta(np.data.cp.status).icon"
                    class="size-3"
                  />
                  {{ meta(np.data.cp.status).label }}
                </span>
              </div>
              <!-- The intended step (what SHOULD happen) — this is the expected
                   flow; the status color/badge above flags drift vs on-track. -->
              <p class="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {{ np.data.cp.expected }}
              </p>
            </div>
          </div>
          <Handle
            type="source"
            :position="Position.Bottom"
            class="!size-1.5 !border-0 !bg-border"
          />
        </button>
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
