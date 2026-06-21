<script setup lang="ts">
import type { Finding } from '#shared/types'
import { computed } from 'vue'
import { AlertTriangle, Lightbulb, ShieldAlert } from 'lucide-vue-next'
import SectionCard from '~/components/SectionCard.vue'
import SeverityBadge from '~/components/SeverityBadge.vue'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

const props = defineProps<{
  finding: Finding
  active?: boolean
}>()

defineEmits<{ (e: 'select', finding: Finding): void }>()

const { severityTone } = useTone()

/**
 * Finding type drives only the icon + label. Color comes from the finding's
 * SEVERITY (routed through useTone), never a hand-picked type hue — so the
 * card reads on one semantic scale instead of two competing color systems.
 */
const typeMeta = computed(() => {
  switch (props.finding.type) {
    case 'failure':
      return { label: 'Failure', icon: ShieldAlert }
    case 'deviation':
      return { label: 'Deviation', icon: AlertTriangle }
    default:
      return { label: 'Missed opportunity', icon: Lightbulb }
  }
})

/** Severity token set tints the icon chip + (when active) the ring. */
const tone = computed(() => severityTone(props.finding.severity))

const hasEvidence = computed(() => (props.finding.evidenceTurnIdxs?.length ?? 0) > 0)

const evidenceLabel = computed(() => {
  const idxs = props.finding.evidenceTurnIdxs ?? []
  if (!idxs.length) return ''
  return `Cites turn${idxs.length > 1 ? 's' : ''} ${idxs.map(i => `#${i}`).join(', ')}`
})
</script>

<template>
  <SectionCard
    interactive
    padding="dense"
    role="button"
    tabindex="0"
    :aria-pressed="active"
    :class="cn(
      'cursor-pointer outline-none transition-colors duration-[var(--dur)] ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      active && 'ring-2 ring-primary'
    )"
    @click="$emit('select', finding)"
    @keydown.enter.prevent="$emit('select', finding)"
    @keydown.space.prevent="$emit('select', finding)"
  >
    <div class="flex gap-3">
      <span
        :class="cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
          tone.badge
        )"
      >
        <component
          :is="typeMeta.icon"
          class="size-4"
        />
      </span>
      <div class="flex min-w-0 flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{{ typeMeta.label }}</span>
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
          class="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary"
        >
          {{ evidenceLabel }}
          <span aria-hidden="true">&rarr;</span>
        </p>
      </div>
    </div>
  </SectionCard>
</template>
