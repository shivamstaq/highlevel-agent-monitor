<script setup lang="ts">
import type { Transcript, UseAction } from '#shared/types'
import { computed, ref, watch } from 'vue'
import { Bot, User } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { cn } from '~/lib/utils'

const props = defineProps<{
  transcript: Transcript
  /** Indices that any finding cites — get a persistent --warning evidence ring. */
  evidenceIdxs?: number[]
  /** Use-actions paint a dedicated --segment left-band across their turn range. */
  useActions?: UseAction[]
  /** Turns to flash (bg-tint fade) + scroll to when a finding is selected. */
  flashIdxs?: number[]
  /** Single active turn — gets the accent (--primary) ring for cross-highlight. */
  activeIdx?: number | null
  /** When false, turns are not clickable (read-only transcript). */
  selectable?: boolean
}>()

const emit = defineEmits<{ (e: 'selectTurn', idx: number): void }>()

const turnRefs = ref<Record<number, HTMLElement | null>>({})
function setTurnRef(idx: number, el: Element | null) {
  turnRefs.value[idx] = el as HTMLElement | null
}

const evidenceSet = computed(() => new Set(props.evidenceIdxs ?? []))
const flashSet = ref<Set<number>>(new Set())

/** Map of turn idx -> useAction band membership (start/end for rounded edges). */
const bandMap = computed(() => {
  const m = new Map<number, { start: boolean, end: boolean }>()
  for (const ua of props.useActions ?? []) {
    const [a, b] = ua.turnRange
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    for (let i = lo; i <= hi; i++) {
      m.set(i, { start: i === lo, end: i === hi })
    }
  }
  return m
})

const isSelectable = computed(() => props.selectable !== false)

watch(() => props.flashIdxs, (idxs) => {
  if (!idxs || !idxs.length) return
  flashSet.value = new Set(idxs)
  const first = Math.min(...idxs)
  const el = turnRefs.value[first]
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => {
    flashSet.value = new Set()
  }, 1600)
})

/** Scroll the active turn into view when it changes from an external source. */
watch(() => props.activeIdx, (idx) => {
  if (idx == null) return
  const el = turnRefs.value[idx]
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

function speakerLabel(s: string): string {
  return s === 'agent' ? 'Voice AI' : 'Customer'
}

function onTurnClick(idx: number) {
  if (isSelectable.value) emit('selectTurn', idx)
}
</script>

<template>
  <ScrollArea class="h-[calc(100svh-13rem)] pr-4">
    <div class="flex flex-col gap-4 py-1">
      <component
        :is="isSelectable ? 'button' : 'div'"
        v-for="turn in transcript.turns"
        :key="turn.idx"
        :ref="(el: unknown) => setTurnRef(turn.idx, el as Element | null)"
        :type="isSelectable ? 'button' : undefined"
        :aria-pressed="isSelectable ? (activeIdx === turn.idx) : undefined"
        :class="cn(
          'flex w-full gap-3 rounded-lg text-left outline-none',
          isSelectable && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          turn.speaker === 'customer' && 'flex-row-reverse'
        )"
        @click="onTurnClick(turn.idx)"
      >
        <div
          :class="cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            turn.speaker === 'agent'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
          )"
        >
          <component
            :is="turn.speaker === 'agent' ? Bot : User"
            class="size-4"
          />
        </div>

        <div
          :class="cn(
            'flex max-w-[82%] flex-col gap-1',
            turn.speaker === 'customer' && 'items-end'
          )"
        >
          <div class="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <span class="font-medium">{{ speakerLabel(turn.speaker) }}</span>
            <span class="font-mono">#{{ turn.idx }}</span>
          </div>

          <!--
            Bubble highlight language (two tokens + accent):
              evidence   -> --warning ring  (finding cites this turn)
              use-action -> --segment left-band (a call segment to action)
              active     -> --primary ring  (currently selected / cross-highlight)
              flash      -> gentle bg-tint fade, motion-safe only (no scale jiggle)
          -->
          <div
            :class="cn(
              'rounded-md border px-3.5 py-2.5 text-sm leading-relaxed transition-colors duration-[var(--dur)] ease-[var(--ease)]',
              turn.speaker === 'agent'
                ? 'rounded-tl-sm bg-card'
                : 'rounded-tr-sm border-transparent bg-secondary text-secondary-foreground',
              bandMap.has(turn.idx) && 'border-l-[3px] border-l-[color:var(--segment)]',
              evidenceSet.has(turn.idx) && 'ring-2 ring-warning/70 ring-offset-1 ring-offset-background',
              activeIdx === turn.idx && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
              flashSet.has(turn.idx) && 'motion-safe:bg-primary/10'
            )"
          >
            {{ turn.text }}
          </div>

          <span
            v-if="bandMap.has(turn.idx)"
            class="px-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--segment)]"
          >
            Use Action segment
          </span>
        </div>
      </component>
    </div>
  </ScrollArea>
</template>
