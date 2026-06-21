<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  /**
   * Apply table-layout:fixed so column widths come from the header cells
   * (colgroup / w-* on th) instead of content. Required for text columns to
   * truncate instead of ballooning and pushing metric columns off-screen (P03).
   */
  fixed?: boolean
}>()
</script>

<template>
  <div
    data-slot="table-container"
    class="relative w-full overflow-auto"
  >
    <table
      data-slot="table"
      :class="cn('w-full caption-bottom text-sm', props.fixed && 'table-fixed', props.class)"
    >
      <slot />
    </table>
  </div>
</template>
