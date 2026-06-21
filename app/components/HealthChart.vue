<script setup lang="ts">
import { computed } from 'vue'
import { VisArea, VisAxis, VisCrosshair, VisLine, VisTooltip, VisXYContainer } from '@unovis/vue'

interface Point { date: string, score: number }

const props = defineProps<{
  trend: Point[]
}>()

const data = computed(() => props.trend.map((p, i) => ({ ...p, i })))

const x = (d: { i: number }) => d.i
const y = (d: { score: number }) => d.score

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
  `<div style="font-size:12px"><div style="color:var(--muted-foreground)">${fmtDate(d.date)}</div><div style="font-weight:600">${Math.round(d.score)} avg score</div></div>`
</script>

<template>
  <div class="h-[260px] w-full">
    <VisXYContainer
      v-if="data.length"
      :data="data"
      :height="260"
      :margin="{ top: 12, right: 12, bottom: 28, left: 32 }"
      :y-domain="[0, 100]"
    >
      <VisArea
        :x="x"
        :y="y"
        color="var(--primary)"
        :opacity="0.12"
      />
      <VisLine
        :x="x"
        :y="y"
        color="var(--primary)"
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
        color="var(--primary)"
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
