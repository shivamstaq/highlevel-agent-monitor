<script setup lang="ts">
import type { UseAction, UseActionKind } from '#shared/types'
import { Eye, GraduationCap, PhoneForwarded, PencilLine } from 'lucide-vue-next'
import { Badge } from '~/components/ui/badge'

defineProps<{
  useActions: UseAction[]
}>()

defineEmits<{ (e: 'focus', range: [number, number]): void }>()

const kindMeta: Record<UseActionKind, { label: string, icon: typeof Eye, cls: string }> = {
  review: { label: 'Review', icon: Eye, cls: 'text-sky-600 dark:text-sky-400' },
  coach_agent: { label: 'Coach agent', icon: GraduationCap, cls: 'text-violet-600 dark:text-violet-400' },
  update_script: { label: 'Update script', icon: PencilLine, cls: 'text-amber-600 dark:text-amber-400' },
  escalate: { label: 'Escalate', icon: PhoneForwarded, cls: 'text-red-600 dark:text-red-400' }
}
</script>

<template>
  <div
    v-if="useActions.length"
    class="flex flex-col gap-2"
  >
    <button
      v-for="ua in useActions"
      :key="ua.id"
      type="button"
      class="group flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/20 hover:bg-accent/40"
      @click="$emit('focus', ua.turnRange)"
    >
      <span :class="['mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted', kindMeta[ua.recommendedAction].cls]">
        <component
          :is="kindMeta[ua.recommendedAction].icon"
          class="size-3.5"
        />
      </span>
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">{{ kindMeta[ua.recommendedAction].label }}</span>
          <Badge
            variant="outline"
            class="font-mono text-[10px]"
          >
            turns {{ ua.turnRange[0] }}–{{ ua.turnRange[1] }}
          </Badge>
        </div>
        <p class="text-sm leading-snug text-muted-foreground">
          {{ ua.reason }}
        </p>
      </div>
    </button>
  </div>
  <p
    v-else
    class="text-sm text-muted-foreground"
  >
    No use-actions flagged for this call.
  </p>
</template>
