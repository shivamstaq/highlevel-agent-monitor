<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { VisArea, VisSingleContainer } from '@unovis/vue'
import { Card, CardContent } from '~/components/ui/card'
import { cn } from '~/lib/utils'

const props = withDefaults(defineProps<{
  label: string
  value: string | number
  icon: Component
  /** Signed delta string e.g. "+2.4%" or "-3". */
  delta?: string
  /** Direction tinting for the delta + accent. */
  trend?: 'up' | 'down' | 'neutral'
  /** Higher-is-worse metrics (failure rate) invert the good/bad coloring. */
  invert?: boolean
  /** Optional sparkline series (y-values). */
  spark?: number[]
  accent?: string
}>(), {
  trend: 'neutral',
  invert: false,
  accent: 'text-primary'
})

const sparkData = computed(() => (props.spark ?? []).map((y, x) => ({ x, y })))

const deltaTone = computed(() => {
  if (props.trend === 'neutral') return 'text-muted-foreground'
  const good = props.invert ? props.trend === 'down' : props.trend === 'up'
  return good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
})
</script>

<template>
  <Card class="relative overflow-hidden gap-0 py-0">
    <CardContent class="flex flex-col gap-3 p-5">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-muted-foreground">{{ label }}</span>
        <span :class="cn('flex size-8 items-center justify-center rounded-lg bg-muted', accent)">
          <component
            :is="icon"
            class="size-4"
          />
        </span>
      </div>

      <div class="flex items-end justify-between gap-2">
        <div class="flex flex-col gap-1">
          <span class="text-3xl font-semibold tracking-tight tabular-nums">{{ value }}</span>
          <span
            v-if="delta"
            :class="cn('text-xs font-medium tabular-nums', deltaTone)"
          >
            {{ delta }}
          </span>
        </div>

        <div
          v-if="sparkData.length > 1"
          class="h-10 w-24 shrink-0 self-end opacity-80"
        >
          <VisSingleContainer
            :data="sparkData"
            :height="40"
          >
            <VisArea
              :x="(d: { x: number }) => d.x"
              :y="(d: { y: number }) => d.y"
              color="currentColor"
              :opacity="0.18"
            />
          </VisSingleContainer>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
