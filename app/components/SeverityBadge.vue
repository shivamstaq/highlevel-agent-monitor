<script setup lang="ts">
import type { Severity } from '#shared/types'
import { computed } from 'vue'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'

const props = withDefaults(defineProps<{
  severity: Severity | null
  /** Render a leading dot instead of a solid fill. */
  subtle?: boolean
  class?: string
}>(), {
  subtle: false
})

const meta = computed(() => {
  switch (props.severity) {
    case 'high':
      return {
        label: 'High',
        solid: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
        dot: 'bg-red-500'
      }
    case 'medium':
      return {
        label: 'Medium',
        solid: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
        dot: 'bg-amber-500'
      }
    case 'low':
      return {
        label: 'Low',
        solid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
        dot: 'bg-emerald-500'
      }
    default:
      return {
        label: 'None',
        solid: 'bg-muted text-muted-foreground',
        dot: 'bg-muted-foreground/40'
      }
  }
})
</script>

<template>
  <Badge
    variant="secondary"
    :class="cn('border-transparent font-medium', subtle ? 'bg-transparent px-0 text-foreground' : meta.solid, props.class)"
  >
    <span
      v-if="subtle"
      :class="cn('size-1.5 rounded-full', meta.dot)"
    />
    {{ meta.label }}
  </Badge>
</template>
