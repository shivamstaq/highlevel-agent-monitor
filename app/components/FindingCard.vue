<script setup lang="ts">
import type { Finding } from '#shared/types'
import { computed } from 'vue'
import { AlertTriangle, Lightbulb, ShieldAlert } from 'lucide-vue-next'
import { Card, CardContent } from '~/components/ui/card'
import SeverityBadge from '~/components/SeverityBadge.vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  finding: Finding
  active?: boolean
}>()

defineEmits<{ (e: 'select', finding: Finding): void }>()

const typeMeta = computed(() => {
  switch (props.finding.type) {
    case 'failure':
      return { label: 'Failure', icon: ShieldAlert, cls: 'text-red-600 dark:text-red-400' }
    case 'deviation':
      return { label: 'Deviation', icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' }
    default:
      return { label: 'Missed opportunity', icon: Lightbulb, cls: 'text-sky-600 dark:text-sky-400' }
  }
})

const hasEvidence = computed(() => (props.finding.evidenceTurnIdxs?.length ?? 0) > 0)
</script>

<template>
  <Card
    :class="cn(
      'cursor-pointer gap-0 py-0 transition-all hover:border-foreground/20 hover:shadow-sm',
      active && 'border-primary/60 ring-1 ring-primary/30'
    )"
    @click="$emit('select', finding)"
  >
    <CardContent class="flex gap-3 p-4">
      <span :class="cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted', typeMeta.cls)">
        <component
          :is="typeMeta.icon"
          class="size-4"
        />
      </span>
      <div class="flex min-w-0 flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ typeMeta.label }}</span>
          <SeverityBadge :severity="finding.severity" />
        </div>
        <p class="text-sm font-semibold leading-snug">
          {{ finding.title }}
        </p>
        <p class="text-sm leading-relaxed text-muted-foreground">
          {{ finding.detail }}
        </p>
        <p
          v-if="hasEvidence"
          class="mt-0.5 text-xs font-medium text-primary"
        >
          Cites turn{{ finding.evidenceTurnIdxs.length > 1 ? 's' : '' }}
          {{ finding.evidenceTurnIdxs.map(i => `#${i}`).join(', ') }} →
        </p>
      </div>
    </CardContent>
  </Card>
</template>
