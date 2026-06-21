<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { VisArea, VisLine, VisSingleContainer } from '@unovis/vue'
import SectionCard from '~/components/SectionCard.vue'
import { useTone, type Tone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

/**
 * KpiCard — standardized KPI anatomy (W13, honesty-revised per P02/P27).
 * Every KPI shares one structure: label (12/500) · metric (30/600 tabular) ·
 * neutral icon chip · OPTIONAL delta line · OPTIONAL sparkline.
 *
 * Honesty-first: a delta and a sparkline are rendered ONLY when a real,
 * honest one is supplied. The card NEVER fabricates a "vs. yesterday" or a
 * stub trend to fill space — an absent delta simply collapses (the row is no
 * longer force-reserved), and the four KPIs still align because they ALL omit
 * the row when none has an honest delta. Pass `delta` only when the compared
 * values are genuinely adjacent + recent; otherwise let the dedicated trend
 * strip below carry the series (P02).
 *
 * Color discipline: the icon chip is neutral by default; accent/status tint
 * is applied ONLY when the metric is in a warning/critical band (via `tone`),
 * routed through useTone — never raw emerald-/amber-/red-NNN utilities.
 */
const props = withDefaults(defineProps<{
  label: string
  value: string | number
  icon: Component
  /**
   * Signed delta / status string e.g. "+2.4% vs Jun 16". OPTIONAL and honest:
   * only pass a real, computed delta — omit it entirely (don't pass "" or a
   * placeholder) when there is no truthful adjacent comparison.
   */
  delta?: string
  /**
   * Band tone for the metric. 'neutral' keeps the chip + metric neutral;
   * 'warning' / 'danger' tint the metric + chip; 'success' tints the metric.
   */
  tone?: Tone
  /** Optional sparkline series (y-values). Shown ONLY when ≥ 2 real points. */
  spark?: number[]
  /** Skeleton state matching the loaded layout. */
  loading?: boolean
}>(), {
  tone: 'neutral'
})

const { toneClasses } = useTone()

const sparkData = computed(() => (props.spark ?? []).map((y, x) => ({ x, y })))

/** Show the sparkline only when there are ≥ 2 honest points to draw a trend. */
const hasSpark = computed(() => sparkData.value.length > 1)

/** Render a delta only when a real, non-empty honest string is supplied. */
const hasDelta = computed(() => {
  const d = props.delta
  return typeof d === 'string' && d.trim().length > 0
})

const toneSet = computed(() => toneClasses(props.tone))

/** Metric tint: only color it when out of band (warning/danger); else neutral foreground. */
const metricClass = computed(() =>
  props.tone === 'warning' || props.tone === 'danger' ? toneSet.value.text : 'text-foreground'
)

/** Icon chip: neutral by default, status-tinted only when out of band. */
const chipClass = computed(() =>
  props.tone === 'warning' || props.tone === 'danger'
    ? cn(toneSet.value.bg, toneSet.value.text)
    : 'bg-muted text-muted-foreground'
)

/** Delta tint follows the band; neutral when within target. */
const deltaClass = computed(() =>
  props.tone === 'neutral' ? 'text-muted-foreground' : toneSet.value.text
)
</script>

<template>
  <SectionCard padding="roomy">
    <div
      v-if="loading"
      class="flex flex-col gap-3"
      aria-hidden="true"
    >
      <div class="flex items-center justify-between">
        <div class="h-4 w-24 animate-pulse rounded-md bg-muted" />
        <div class="size-8 animate-pulse rounded-md bg-muted" />
      </div>
      <div class="h-8 w-20 animate-pulse rounded-md bg-muted" />
      <div class="h-4 w-16 animate-pulse rounded-md bg-muted" />
    </div>

    <div
      v-else
      class="flex flex-col gap-3"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-[12px] font-medium text-muted-foreground">{{ label }}</span>
        <span :class="cn('flex size-8 items-center justify-center rounded-md', chipClass)">
          <component
            :is="icon"
            class="size-4"
          />
        </span>
      </div>

      <div class="flex items-end justify-between gap-3">
        <span :class="cn('text-[30px] font-semibold leading-none tracking-tight tabular-nums', metricClass)">
          {{ value }}
        </span>

        <div
          v-if="hasSpark"
          class="h-9 w-24 shrink-0 self-end text-primary/70"
        >
          <VisSingleContainer
            :data="sparkData"
            :height="36"
          >
            <VisArea
              :x="(d: { x: number }) => d.x"
              :y="(d: { y: number }) => d.y"
              color="currentColor"
              :opacity="0.18"
            />
            <VisLine
              :x="(d: { x: number }) => d.x"
              :y="(d: { y: number }) => d.y"
              color="currentColor"
              :line-width="1.5"
            />
          </VisSingleContainer>
        </div>
      </div>

      <!--
        Delta row is OPTIONAL + honesty-first: it renders only when a real,
        non-empty delta is provided (P02/P27). No placeholder, no reserved
        empty row — when no KPI has an honest delta the line is simply absent
        and all four cards still align.
      -->
      <p
        v-if="hasDelta"
        :class="cn('text-[12px] font-medium tabular-nums', deltaClass)"
      >
        {{ delta }}
      </p>
    </div>
  </SectionCard>
</template>
