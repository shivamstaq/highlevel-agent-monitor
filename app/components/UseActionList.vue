<script setup lang="ts">
import type { UseAction, UseActionKind } from '#shared/types'
import { computed } from 'vue'
import { Eye, GraduationCap, PhoneForwarded, Wrench } from 'lucide-vue-next'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

const props = withDefaults(defineProps<{
  useActions: UseAction[]
  /** Optional: highlight the use-action whose range is currently focused. */
  activeRange?: [number, number] | null
}>(), {
  activeRange: null
})

defineEmits<{ (e: 'focus', range: [number, number]): void }>()

const { toneClasses } = useTone()

/**
 * Use Action kind -> icon + tone. Tone routes through useTone semantic tokens
 * (no raw sky-/violet-/amber-/red utilities): escalate = danger, update_script
 * = warning, coach_agent / review = neutral.
 */
const kindMeta: Record<UseActionKind, { label: string, icon: typeof Eye, tone: ReturnType<typeof toneClasses> }> = {
  review: { label: 'Review', icon: Eye, tone: toneClasses('neutral') },
  coach_agent: { label: 'Coach agent', icon: GraduationCap, tone: toneClasses('neutral') },
  update_script: { label: 'Update script', icon: Wrench, tone: toneClasses('warning') },
  escalate: { label: 'Escalate', icon: PhoneForwarded, tone: toneClasses('danger') }
}

function isActive(ua: UseAction): boolean {
  const r = props.activeRange
  return !!r && r[0] === ua.turnRange[0] && r[1] === ua.turnRange[1]
}

const sorted = computed(() => props.useActions)
</script>

<template>
  <div
    v-if="useActions.length"
    class="flex flex-col gap-3"
  >
    <!--
      First-use inline definition of the coined term "Use Actions" (P16).
      Defines what a use-action IS before the list, so a first-time operator
      isn't dropped straight into a worklist of un-glossed jargon.
    -->
    <p class="text-[12px] leading-relaxed text-muted-foreground">
      <span class="font-medium text-foreground">Use Actions</span> are specific call
      segments that need a human — for review, coaching, or script training.
    </p>

    <div class="flex flex-col gap-2">
      <button
        v-for="ua in sorted"
        :key="ua.id"
        type="button"
        :aria-pressed="isActive(ua)"
        :class="cn(
          'group flex items-start gap-3 rounded-md border bg-card p-3 text-left outline-none transition-colors duration-[var(--dur)] ease-[var(--ease)] hover:border-foreground/20 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          isActive(ua) && 'border-primary/60 ring-1 ring-primary/40'
        )"
        @click="$emit('focus', ua.turnRange)"
      >
        <span
          :class="cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
            kindMeta[ua.recommendedAction].tone.badge
          )"
        >
          <component
            :is="kindMeta[ua.recommendedAction].icon"
            class="size-3.5"
          />
        </span>
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">{{ kindMeta[ua.recommendedAction].label }}</span>
            <span class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              turns {{ ua.turnRange[0] }}&ndash;{{ ua.turnRange[1] }}
            </span>
          </div>
          <p class="text-sm leading-snug text-muted-foreground">
            {{ ua.reason }}
          </p>
        </div>
      </button>
    </div>
  </div>
  <div
    v-else
    class="flex flex-col items-center gap-1.5 px-4 py-8 text-center"
  >
    <span class="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Wrench class="size-4" />
    </span>
    <p class="text-sm font-semibold">
      No Use Actions for this call
    </p>
    <p class="max-w-xs text-sm text-muted-foreground">
      Nothing here needs a human follow-up. Re-run analysis to refresh if the transcript changed.
    </p>
  </div>
</template>
