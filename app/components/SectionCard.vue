<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { cn } from '~/lib/utils'

/**
 * SectionCard — the single card wrapper for the whole app.
 *
 * Replaces the ad-hoc Card + CardHeader pattern so per-instance padding /
 * radius / elevation drift can't recur. Cards are reserved for heterogeneous
 * content + the 4-up KPI row; homogeneous record lists use <CallTable> /
 * <AgentTable> instead.
 *
 * Header (py-4, border-b) renders only when there's a title, eyebrow, or
 * #actions slot. Resting card = elevation-1; pass `interactive` to lift to
 * elevation-2 on hover (motion-safe).
 */
const props = withDefaults(defineProps<{
  title?: string
  description?: string
  /** 11px uppercase eyebrow, used sparingly. */
  eyebrow?: string
  /** Lift to elevation-2 on hover (for clickable / link cards). */
  interactive?: boolean
  /** Body padding tier: 'roomy' = p-5, 'dense' = p-4, 'flush' = p-0 (tables). */
  padding?: 'roomy' | 'dense' | 'flush'
  class?: string
  /** Extra classes for the body region. */
  bodyClass?: string
}>(), {
  padding: 'roomy'
})

const slots = useSlots()

const hasHeader = computed(() =>
  Boolean(props.title || props.eyebrow || slots.actions)
)

const bodyPadding = computed(() => {
  switch (props.padding) {
    case 'flush': return 'p-0'
    case 'dense': return 'p-4'
    default: return 'p-5'
  }
})
</script>

<template>
  <section
    :class="cn(
      'rounded-xl border bg-card text-card-foreground elevation-1',
      interactive && 'transition-shadow duration-[var(--dur)] ease-[var(--ease)] motion-safe:hover:elevation-2',
      props.class
    )"
  >
    <header
      v-if="hasHeader"
      class="flex items-start justify-between gap-4 border-b px-5 py-4"
    >
      <div class="min-w-0 space-y-0.5">
        <p
          v-if="eyebrow"
          class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {{ eyebrow }}
        </p>
        <h2
          v-if="title"
          class="text-[18px] font-semibold leading-tight tracking-tight"
        >
          {{ title }}
        </h2>
        <p
          v-if="description"
          class="text-sm text-muted-foreground"
        >
          {{ description }}
        </p>
      </div>
      <div
        v-if="slots.actions"
        class="flex shrink-0 items-center gap-2"
      >
        <slot name="actions" />
      </div>
    </header>

    <div :class="cn(bodyPadding, bodyClass)">
      <slot />
    </div>
  </section>
</template>
