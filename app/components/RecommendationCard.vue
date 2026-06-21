<script setup lang="ts">
import type { Recommendation } from '#shared/types'
import { computed, ref } from 'vue'
import { Check, Copy, FileText, GraduationCap, Settings2, SlidersHorizontal } from 'lucide-vue-next'
import { Card, CardContent } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import SeverityBadge from '~/components/SeverityBadge.vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  recommendation: Recommendation
  /** Hide the suggested-change code block (compact list contexts). */
  compact?: boolean
}>()

const targetMeta = computed(() => {
  switch (props.recommendation.target) {
    case 'prompt':
      return { label: 'System prompt', icon: SlidersHorizontal }
    case 'script':
      return { label: 'Call script', icon: FileText }
    case 'agent_config':
      return { label: 'Agent config', icon: Settings2 }
    default:
      return { label: 'Coaching', icon: GraduationCap }
  }
})

const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(props.recommendation.suggestedChange)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <Card class="gap-0 py-0">
    <CardContent class="flex flex-col gap-3 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              class="gap-1 font-medium"
            >
              <component
                :is="targetMeta.icon"
                class="size-3"
              />
              {{ targetMeta.label }}
            </Badge>
            <div class="flex items-center gap-1 text-xs text-muted-foreground">
              Impact
              <SeverityBadge :severity="recommendation.impact" />
            </div>
          </div>
          <p class="text-sm font-semibold leading-snug">
            {{ recommendation.title }}
          </p>
        </div>
      </div>

      <p class="text-sm leading-relaxed text-muted-foreground">
        {{ recommendation.rationale }}
      </p>

      <div
        v-if="!compact && recommendation.suggestedChange"
        class="relative rounded-lg border bg-muted/50 p-3"
      >
        <pre class="overflow-x-auto whitespace-pre-wrap break-words pr-9 font-mono text-xs leading-relaxed text-foreground/90">{{ recommendation.suggestedChange }}</pre>
        <Button
          variant="ghost"
          size="icon-sm"
          class="absolute right-1.5 top-1.5"
          :aria-label="copied ? 'Copied' : 'Copy suggested change'"
          @click="copy"
        >
          <component
            :is="copied ? Check : Copy"
            :class="cn('size-3.5', copied && 'text-emerald-600')"
          />
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
