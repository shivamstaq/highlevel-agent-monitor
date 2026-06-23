<script setup lang="ts">
/**
 * FlowNodeDetail — the insight panel for a selected node in the flow-drift graph.
 * Shows the intended behavior vs what actually happened vs how to re-align, with
 * cited transcript evidence (click a chip to cross-highlight). When nothing is
 * selected it shows the flow summary + drift legend.
 */
import type { FlowAlignment, FlowAlignmentStatus, InferredFlow } from '#shared/types'
import { computed } from 'vue'
import { ArrowRight, GitBranch, Lightbulb, MousePointerClick, Target, Zap } from 'lucide-vue-next'
import { cn } from '~/lib/utils'

const props = defineProps<{
  flow: InferredFlow | null
  alignment?: FlowAlignment | null
  selectedNodeId?: string | null
  /** A clicked edge — shows its branch condition (full text). */
  selectedEdge?: { condition: string, from: string, to: string } | null
  activeEntryIdxs?: number[]
}>()

const emit = defineEmits<{ (e: 'select', entryIdxs: number[]): void }>()

const STATUS_META: Record<FlowAlignmentStatus, { badge: string, label: string }> = {
  on_track: { badge: 'bg-success-soft text-foreground', label: 'On track' },
  drifted: { badge: 'bg-warning-soft text-foreground', label: 'Drifted' },
  skipped: { badge: 'bg-danger-soft text-foreground', label: 'Skipped' },
  not_reached: { badge: 'bg-muted text-muted-foreground', label: 'Not reached' }
}

const counts = computed(() => {
  const c = { on_track: 0, drifted: 0, skipped: 0, not_reached: 0 }
  for (const a of props.alignment?.nodeAlignments ?? []) c[a.status]++
  return c
})

interface Detail {
  label: string
  isTangent: boolean
  status?: FlowAlignmentStatus
  intended?: string
  actual: string
  recommendation: string
  evidence: number[]
}

const detail = computed<Detail | null>(() => {
  const id = props.selectedNodeId
  if (!id) return null
  const tangent = props.alignment?.tangents.find(t => t.id === id)
  if (tangent) {
    return {
      label: tangent.label,
      isTangent: true,
      actual: tangent.description,
      recommendation: tangent.recommendation,
      evidence: tangent.evidenceEntryIdxs
    }
  }
  const node = props.flow?.nodes.find(n => n.id === id)
  if (!node) return null
  const a = props.alignment?.nodeAlignments.find(x => x.nodeId === id)
  return {
    label: node.label,
    isTangent: false,
    status: a?.status,
    intended: node.description,
    actual: a?.actual ?? '',
    recommendation: a?.recommendation ?? '',
    evidence: a?.evidenceEntryIdxs ?? []
  }
})

const activeSet = computed(() => new Set(props.activeEntryIdxs ?? []))

/** Resolved branch-condition detail for a clicked edge. */
const edgeDetail = computed(() => {
  const e = props.selectedEdge
  if (!e) return null
  const label = (id: string) => props.flow?.nodes.find(n => n.id === id)?.label ?? id
  return { condition: e.condition, fromLabel: label(e.from), toLabel: label(e.to) }
})
</script>

<template>
  <div class="rounded-xl border bg-card p-3.5 elevation-1">
    <!-- Clicked edge: its branch condition (full text) -->
    <template v-if="edgeDetail">
      <div class="mb-2.5 flex items-center gap-1.5">
        <span class="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
          <GitBranch class="size-3" />
        </span>
        <h4 class="text-sm font-semibold">
          Branch condition
        </h4>
      </div>
      <div class="rounded-lg border border-primary/25 bg-primary/[0.05] p-2.5">
        <p class="text-[13px] leading-snug text-foreground/90">
          {{ edgeDetail.condition }}
        </p>
      </div>
      <p class="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
        <span class="font-medium text-foreground">{{ edgeDetail.fromLabel }}</span>
        <ArrowRight class="size-3" />
        <span class="font-medium text-foreground">{{ edgeDetail.toLabel }}</span>
      </p>
    </template>

    <!-- Selected node detail -->
    <template v-else-if="detail">
      <div class="mb-2.5 flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <span :class="cn('flex size-5 shrink-0 items-center justify-center rounded', detail.isTangent ? 'bg-danger-soft text-danger' : 'bg-primary/10 text-primary')">
            <component
              :is="detail.isTangent ? Zap : Target"
              class="size-3"
            />
          </span>
          <h4 class="truncate text-sm font-semibold">
            {{ detail.label }}
          </h4>
        </div>
        <span
          v-if="detail.status"
          :class="cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_META[detail.status].badge)"
        >
          {{ STATUS_META[detail.status].label }}
        </span>
        <span
          v-else-if="detail.isTangent"
          class="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-danger-foreground"
        >
          Off-script
        </span>
      </div>

      <div class="flex flex-col gap-2">
        <div
          v-if="detail.intended"
          class="rounded-lg border border-primary/25 bg-primary/[0.05] p-2.5"
        >
          <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Intended
          </p>
          <p class="text-[13px] leading-snug text-foreground/90">
            {{ detail.intended }}
          </p>
        </div>
        <div
          v-if="detail.actual"
          class="rounded-lg border bg-muted/30 p-2.5"
        >
          <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            What happened
          </p>
          <p class="text-[13px] leading-snug text-foreground/90">
            {{ detail.actual }}
          </p>
        </div>
        <div
          v-if="detail.recommendation"
          class="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-soft/40 p-2.5"
        >
          <Lightbulb class="mt-0.5 size-3.5 shrink-0 text-warning" />
          <div>
            <p class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
              How to re-align
            </p>
            <p class="text-[13px] leading-snug text-foreground/90">
              {{ detail.recommendation }}
            </p>
          </div>
        </div>

        <div
          v-if="detail.evidence.length"
          class="flex flex-wrap items-center gap-1.5 pt-0.5"
        >
          <span class="text-[11px] text-muted-foreground">Evidence:</span>
          <button
            v-for="idx in detail.evidence"
            :key="idx"
            type="button"
            :class="cn(
              'rounded-md border px-1.5 py-0.5 font-mono text-[11px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              activeSet.has(idx) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )"
            @click="emit('select', [idx])"
          >
            #{{ idx }}
          </button>
          <button
            v-if="detail.evidence.length > 1"
            type="button"
            class="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            @click="emit('select', detail.evidence)"
          >
            highlight all
          </button>
        </div>
      </div>
    </template>

    <!-- Empty state: summary + legend -->
    <template v-else>
      <p
        v-if="alignment?.summary"
        class="mb-2.5 text-[13px] leading-snug text-muted-foreground"
      >
        {{ alignment.summary }}
      </p>
      <!-- Drift legend only when there's a per-call alignment overlay. -->
      <div
        v-if="alignment?.nodeAlignments.length"
        class="mb-3 flex flex-wrap gap-1.5"
      >
        <span class="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-foreground">
          <span class="size-1.5 rounded-full bg-success" /> {{ counts.on_track }} on track
        </span>
        <span
          v-if="counts.drifted"
          class="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-foreground"
        >
          <span class="size-1.5 rounded-full bg-warning" /> {{ counts.drifted }} drifted
        </span>
        <span
          v-if="counts.skipped"
          class="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-foreground"
        >
          <span class="size-1.5 rounded-full bg-danger" /> {{ counts.skipped }} skipped
        </span>
        <span
          v-if="alignment?.tangents.length"
          class="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[11px] font-medium text-danger-foreground"
        >
          <Zap class="size-3" /> {{ alignment.tangents.length }} off-script
        </span>
      </div>
      <p class="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <MousePointerClick class="size-3.5" />
        {{ alignment?.nodeAlignments.length
          ? 'Tap any step in the flow to see intended vs actual and how to re-align.'
          : 'Tap any step in the flow to see what it should accomplish and its rules.' }}
      </p>
    </template>
  </div>
</template>
