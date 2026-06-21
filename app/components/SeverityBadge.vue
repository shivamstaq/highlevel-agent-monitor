<script setup lang="ts">
import type { Severity } from '#shared/types'
import { computed } from 'vue'
import { Badge } from '~/components/ui/badge'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

/**
 * SeverityBadge — the canonical status pill for finding/recommendation
 * severity. ALL color routes through useTone().severityTone — no raw
 * emerald-/amber-/red-NNN utilities. Used by CallTable, FindingCard,
 * RecommendationCard, and the agent/call surfaces.
 */
const props = withDefaults(defineProps<{
  severity: Severity | null
  /** Render a leading dot on a transparent surface instead of a filled pill. */
  subtle?: boolean
  class?: string
}>(), {
  subtle: false
})

const { severityTone, severityLabel } = useTone()

const tone = computed(() => severityTone(props.severity))
const label = computed(() => severityLabel(props.severity))
</script>

<template>
  <Badge
    variant="secondary"
    :class="cn(
      'gap-1.5 rounded-full border-transparent text-[12px] font-medium',
      subtle ? 'bg-transparent px-0 text-foreground' : tone.badge,
      props.class
    )"
  >
    <span
      v-if="subtle"
      :class="cn('size-1.5 rounded-full', tone.dot)"
    />
    {{ label }}
  </Badge>
</template>
