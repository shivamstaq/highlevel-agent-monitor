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
  /**
   * Single active turn — gets the accent (--primary) ring for cross-highlight.
   * Kept for back-compat; prefer `activeTurnIdxs` for a persisted multi-turn
   * selection (e.g. a clicked timeline bar or use-action range).
   */
  activeIdx?: number | null
  /**
   * Persisted active selection (P13): every index here keeps the accent ring,
   * stably, until the selection changes — NOT a transient 1.6s flash. Drives the
   * stable transcript<->timeline<->flow cross-highlight. Merged with `activeIdx`.
   */
  activeTurnIdxs?: number[]
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

/**
 * The PERSISTED active selection (P13): the union of the single `activeIdx`
 * and the `activeTurnIdxs` array. Every member keeps a stable accent ring —
 * the highlight is state, not a transient flash, so cross-highlight from the
 * timeline / flow stays painted until the selection itself changes.
 */
const activeSet = computed(() => {
  const s = new Set(props.activeTurnIdxs ?? [])
  if (props.activeIdx != null) s.add(props.activeIdx)
  return s
})

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

/** Reduced-motion-safe scroll: honor prefers-reduced-motion for scrollIntoView. */
function scrollTurnIntoView(idx: number) {
  const el = turnRefs.value[idx]
  if (!el) return
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
}

const isSelectable = computed(() => props.selectable !== false)

watch(() => props.flashIdxs, (idxs) => {
  if (!idxs || !idxs.length) return
  flashSet.value = new Set(idxs)
  scrollTurnIntoView(Math.min(...idxs))
  setTimeout(() => {
    flashSet.value = new Set()
  }, 1600)
})

/**
 * Scroll the persisted active selection into view when it changes from an
 * external source (a clicked timeline bar / flow node). Uses the lowest active
 * index as the scroll anchor; reduced-motion safe.
 */
watch(
  [() => props.activeIdx, () => props.activeTurnIdxs],
  () => {
    const idxs = [...activeSet.value]
    if (!idxs.length) return
    scrollTurnIntoView(Math.min(...idxs))
  }
)

function speakerLabel(s: string): string {
  return s === 'agent' ? 'Voice AI' : 'Customer'
}

function onTurnClick(idx: number) {
  if (isSelectable.value) emit('selectTurn', idx)
}
</script>

<template>
  <!--
    R3-03: the inner scroll viewport must stay usable on phone, where the call
    header wraps taller (the old hardcoded 100svh-13rem could collapse to a
    sliver). Reserve a larger offset below sm and floor the height so the
    transcript always has a comfortable scrollable area on a 390px screen.
  -->
  <ScrollArea class="h-[max(20rem,calc(100svh-19rem))] pr-4 sm:h-[calc(100svh-13rem)]">
    <div class="flex flex-col gap-4 py-1">
      <component
        :is="isSelectable ? 'button' : 'div'"
        v-for="turn in transcript.turns"
        :key="turn.idx"
        :ref="(el: unknown) => setTurnRef(turn.idx, el as Element | null)"
        :type="isSelectable ? 'button' : undefined"
        :aria-pressed="isSelectable ? activeSet.has(turn.idx) : undefined"
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

        <!--
          R3-03 phone overflow fix: the bubble column is capped to the space
          left after the size-8 avatar + gap-3 (2.75rem) so it can never exceed
          the container and force horizontal clipping at 390px. On wider panes
          it keeps the comfortable 82% conversational max-width.
        -->
        <div
          :class="cn(
            'flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col gap-1 sm:max-w-[82%]',
            turn.speaker === 'customer' && 'items-end'
          )"
        >
          <div class="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <span class="font-medium">{{ speakerLabel(turn.speaker) }}</span>
            <span class="font-mono">#{{ turn.idx }}</span>
          </div>

          <!--
            Bubble highlight language — two semantic tokens + the accent:
              evidence   -> --warning ring  (a finding cites this turn)
              use-action -> --segment left-band (a call segment to action)
              active     -> --primary ring  (PERSISTED selection / cross-highlight,
                            stable until the selection changes — not a flash)
              flash      -> gentle bg-tint fade, motion-safe only (no scale jiggle)
            The evidence ring and the use-action band are deliberately distinct
            tokens so "cited as evidence" never reads the same as "needs action".
          -->
          <div
            :class="cn(
              'max-w-full overflow-hidden rounded-md border px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] transition-colors duration-[var(--dur)] ease-[var(--ease)]',
              turn.speaker === 'agent'
                ? 'rounded-tl-sm bg-card'
                : 'rounded-tr-sm border-transparent bg-secondary text-secondary-foreground',
              bandMap.has(turn.idx) && 'border-l-[3px] border-l-[color:var(--segment)]',
              evidenceSet.has(turn.idx) && 'ring-2 ring-warning/70 ring-offset-1 ring-offset-background',
              activeSet.has(turn.idx) && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
              flashSet.has(turn.idx) && 'motion-safe:bg-primary/10'
            )"
          >
            {{ turn.text }}
          </div>

          <!--
            P14: render the band label ONCE, on the band's first turn, so a
            7-turn use-action range gets one clear annotation instead of 7
            repeats. The left-band stays on every turn for visual continuity.
          -->
          <span
            v-if="bandMap.get(turn.idx)?.start"
            class="px-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--segment)]"
          >
            Use Action segment
          </span>
        </div>
      </component>
    </div>
  </ScrollArea>
</template>
