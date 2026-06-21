<script setup lang="ts">
import type { ExpectedFlow, FlowAlignment, NodeAlignment, NodeStatus } from '#shared/types'
import { computed } from 'vue'
import { ArrowRight, CheckCircle2, ChevronRight, CircleSlash, Info, MoveRight, PlusCircle, ShuffleIcon } from 'lucide-vue-next'
import { Progress } from '~/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import SectionCard from '~/components/SectionCard.vue'
import FlowDiagram from '~/components/FlowDiagram.vue'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

/**
 * FlowDrift — the call's Flow adherence rollup made EXPECTED-vs-ACTUAL explicit:
 * the ordered ACTUAL path the call traversed (P18) rendered against the expected
 * flow, a tinted flow graph, and a clickable drift list that cross-highlights
 * the cited turns.
 *
 * Lexicon (P09): the headline is "Flow adherence" (= conformanceScore), defined
 * inline on first use. "Fitness" appears only as a small, clearly-defined
 * secondary stat — never as a second headline ("Conformance"/"Process fitness"
 * are retired as headline labels).
 *
 * All status color routes through useTone() tokens (no raw emerald-/amber-/red).
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
 * Expected-vs-actual (P18) — make "designed vs happened" explicit.
 *
 * `expectedSteps` is the designed flow's required spine in order, each tagged
 * with the status it ended up in (hit / skipped / out_of_order) so a skipped
 * required step is called out inline rather than left to inference.
 *
 * `actualSteps` is the ordered list of nodes the call ACTUALLY traversed
 * (alignment.actualPath), resolved to labels + status, with 'extra' (unplanned)
 * behaviors interleaved by the order they appeared. This is the one datum that
 * makes process-mining "actual vs design intent" visible at a glance.
 * ------------------------------------------------------------------------- */
const labelByNodeId = computed(() => {
  const m = new Map<string, string>()
  for (const n of props.flow.nodes) m.set(n.id, n.label)
  return m
})

const alignByNodeId = computed(() => {
  const m = new Map<string, NodeAlignment>()
  for (const na of props.alignment.nodeAlignments) {
    if (na.nodeId) m.set(na.nodeId, na)
  }
  return m
})

interface PathStep {
  key: string
  label: string
  nodeId?: string
  status: NodeStatus
  /** Whether skipping is benign (untriggered conditional branch). */
  benign: boolean
}

/** The designed required spine, in order, tagged with how the call did on it. */
const expectedSteps = computed<PathStep[]>(() =>
  props.flow.nodes
    .filter(n => n.expected)
    .map((n) => {
      const na = alignByNodeId.value.get(n.id)
      const status: NodeStatus = na?.status ?? 'skipped'
      return {
        key: `exp-${n.id}`,
        label: n.label,
        nodeId: n.id,
        status,
        benign: false
      }
    })
)

/** The ordered path the call actually walked (process-mining log moves). */
const actualSteps = computed<PathStep[]>(() => {
  const steps: PathStep[] = props.alignment.actualPath.map((id, i) => {
    const na = alignByNodeId.value.get(id)
    return {
      key: `act-${id}-${i}`,
      label: labelByNodeId.value.get(id) ?? na?.label ?? id,
      nodeId: id,
      status: na?.status ?? 'hit',
      benign: false
    }
  })
  // Append any 'extra' (unplanned) behaviours that have no expected node id.
  props.alignment.nodeAlignments
    .filter(na => na.status === 'extra')
    .forEach((na, i) => steps.push({
      key: `extra-${i}`,
      label: na.label,
      status: 'extra',
      benign: false
    }))
  return steps
})

/** Required steps the call skipped (the headline gap of the actual path). */
const skippedRequired = computed<PathStep[]>(() =>
  expectedSteps.value.filter(s => s.status === 'skipped')
)

const hasActualPath = computed(() => actualSteps.value.length > 0)

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
    <!-- Flow adherence header (tokenized band). The ONE headline metric; fitness
         is demoted to a small defined secondary stat (P09 lexicon). -->
    <TooltipProvider :delay-duration="120">
      <div class="flex flex-col gap-3 border-b bg-muted/30 p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1.5">
            <!-- Flow adherence — defined inline on first use (P09/P16) -->
            <div class="flex items-center gap-1.5">
              <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Flow adherence
              </p>
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="rounded-full text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:text-foreground"
                    aria-label="What is Flow adherence?"
                  >
                    <Info class="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent class="max-w-xs text-xs leading-relaxed">
                  How closely this call followed its expected flow — every
                  required step hit, in the designed order. 100 = walked the
                  flow exactly; lower = steps were skipped, taken out of order,
                  or unplanned ones were added.
                </TooltipContent>
              </Tooltip>
            </div>
            <p class="text-xs text-muted-foreground">
              Did the call follow the steps it was designed to.
            </p>
          </div>
          <span :class="cn('shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium', conformanceTone.badge)">{{ conformanceBandLabel }}</span>
        </div>

        <div class="flex items-end justify-between gap-4">
          <div class="flex items-end gap-1.5">
            <span :class="cn('text-[30px] font-semibold leading-none tabular-nums', conformanceTone.text)">{{ Math.round(conformance) }}</span>
            <span class="pb-0.5 text-sm text-muted-foreground">/ 100</span>
          </div>
          <!-- Fitness: small, clearly-defined secondary stat (no second headline) -->
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="flex cursor-help items-baseline gap-1 text-[12px] text-muted-foreground">
                <span class="font-medium tabular-nums text-foreground">{{ fitnessPct }}%</span>
                required steps in order
                <Info class="size-3 translate-y-0.5 text-muted-foreground/60" />
              </span>
            </TooltipTrigger>
            <TooltipContent class="max-w-xs text-xs leading-relaxed">
              Process fitness — the share of required steps the call hit in the
              designed order. (A step that occurred but out of sequence is
              counted by Flow adherence's ordering penalty, not here.)
            </TooltipContent>
          </Tooltip>
        </div>

        <Progress
          :model-value="conformance"
          :class="cn('h-2', conformanceBar)"
        />
      </div>
    </TooltipProvider>

    <!-- Expected vs actual (P18): the ordered ACTUAL path the call traversed,
         shown against the designed flow so "designed vs happened" is explicit. -->
    <div class="flex flex-col gap-3 border-b p-5">
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold">
          Expected vs actual path
        </h3>
        <span class="text-xs text-muted-foreground">— the order the call really walked</span>
      </div>

      <!-- Actual path breadcrumb -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Actual path</span>
        <div
          v-if="hasActualPath"
          class="flex flex-wrap items-center gap-x-1 gap-y-1.5"
        >
          <template
            v-for="(step, i) in actualSteps"
            :key="step.key"
          >
            <ChevronRight
              v-if="i > 0"
              class="size-3.5 shrink-0 text-muted-foreground/40"
            />
            <span
              :class="cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs',
                step.status === 'extra' ? cn(statusTone('extra').badge, 'border-danger/30') : 'bg-card',
                step.status === 'out_of_order' && cn(statusTone('out_of_order').badge, 'border-warning/30')
              )"
            >
              <span :class="cn('size-1.5 shrink-0 rounded-full', statusTone(step.status).dot)" />
              {{ step.label }}
              <span
                v-if="step.status === 'out_of_order'"
                class="text-[10px] uppercase tracking-wide opacity-80"
              >out of order</span>
              <span
                v-else-if="step.status === 'extra'"
                class="text-[10px] uppercase tracking-wide opacity-80"
              >unplanned</span>
            </span>
          </template>
        </div>
        <p
          v-else
          class="text-xs text-muted-foreground"
        >
          No flow steps were enacted on this call.
        </p>
      </div>

      <!-- Skipped required steps — the gap between expected and actual -->
      <div
        v-if="skippedRequired.length"
        class="flex flex-wrap items-center gap-x-2 gap-y-1.5"
      >
        <span class="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <CircleSlash :class="cn('size-3.5', statusTone('skipped').text)" />
          Skipped (expected but never happened)
        </span>
        <span
          v-for="step in skippedRequired"
          :key="step.key"
          :class="cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs line-through decoration-warning/50', statusTone('skipped').badge)"
        >
          {{ step.label }}
        </span>
      </div>
      <p
        v-else
        :class="cn('text-xs', statusTone('hit').text)"
      >
        Every expected step occurred — no skipped required steps.
      </p>
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
