<script setup lang="ts">
import { computed } from 'vue'
import { VisArea, VisAxis, VisCrosshair, VisLine, VisTooltip, VisXYContainer } from '@unovis/vue'

interface Point { date: string, score: number }

const props = withDefaults(defineProps<{
  trend: Point[]
  /** Plot height in px. Default tightened to ~180px (W25). */
  height?: number
}>(), {
  height: 180
})

const data = computed(() => props.trend.map((p, i) => ({ ...p, i })))

const x = (d: { i: number }) => d.i
const y = (d: { score: number }) => d.score

/**
 * Padded auto y-domain: floor at (min - 10) clamped to >= 0, ceiling 100.
 * A 55-65 series fills the plot instead of hugging a hard [0,100] floor.
 */
const yDomain = computed<[number, number]>(() => {
  if (!data.value.length) return [0, 100]
  const min = Math.min(...data.value.map(d => d.score))
  const lo = Math.max(0, Math.floor(min - 10))
  return [lo, 100]
})

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const tickFormat = (i: number) => {
  const p = data.value[i]
  return p ? fmtDate(p.date) : ''
}

const tooltipTemplate = (d: { date: string, score: number }) =>
  `<div style="font-size:12px;font-family:var(--font-sans)"><div style="color:var(--muted-foreground)">${fmtDate(d.date)}</div><div style="font-weight:600;font-variant-numeric:tabular-nums">${Math.round(d.score)} avg score</div></div>`
</script>

<template>
  <div
    class="w-full [--vis-axis-grid-color:var(--chart-grid)] [--vis-axis-tick-label-color:var(--muted-foreground)]"
    :style="{ height: `${height}px` }"
  >
    <VisXYContainer
      v-if="data.length"
      :data="data"
      :height="height"
      :margin="{ top: 12, right: 12, bottom: 28, left: 32 }"
      :y-domain="yDomain"
    >
      <VisArea
        :x="x"
        :y="y"
        color="var(--chart-1)"
        :opacity="0.1"
      />
      <VisLine
        :x="x"
        :y="y"
        color="var(--chart-1)"
        :line-width="2.5"
      />
      <VisAxis
        type="x"
        :tick-format="tickFormat"
        :grid-line="false"
        :tick-line="false"
        :domain-line="false"
        :num-ticks="Math.min(data.length, 7)"
      />
      <VisAxis
        type="y"
        :tick-line="false"
        :domain-line="false"
        :num-ticks="4"
      />
      <VisCrosshair
        :template="tooltipTemplate"
        color="var(--chart-1)"
      />
      <VisTooltip />
    </VisXYContainer>

    <div
      v-else
      class="flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      No analysis history yet.
    </div>
  </div>
</template>
