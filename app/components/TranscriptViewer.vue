<!-- BORROWED data (GHL transcriptWithToolCalls), CREATED projection — renders
     the normalized Transcript.entries discriminated union: spoken turns
     (role agent|customer) plus inline action entries (role 'action'). Highlight
     is keyed by transcript entry idx, driven by findings / use-actions / the
     timeline (evidenceEntryIdxs / entryRange / matchedEntryIdxs). -->
<script setup lang="ts">
import type { ActionEntry, Transcript, TranscriptEntry, TurnEntry, UseAction } from '#shared/types'
import { computed, ref, watch } from 'vue'
import { Bot, User, Wrench } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { cn } from '~/lib/utils'

const props = defineProps<{
  transcript: Transcript
  /** Entry idxs that any finding cites — get a persistent --warning evidence ring. */
  evidenceIdxs?: number[]
  /** Use-actions paint a dedicated --segment left-band across their entry range. */
  useActions?: UseAction[]
  /** Entries to flash (bg-tint fade) + scroll to when a finding is selected. */
  flashIdxs?: number[]
  /**
   * Single active entry — gets the accent (--primary) ring for cross-highlight.
   * Kept for back-compat; prefer `activeTurnIdxs` for a persisted multi-entry
   * selection (e.g. a clicked timeline bar or use-action range).
   */
  activeIdx?: number | null
  /**
   * Persisted active selection (P13): every index here keeps the accent ring,
   * stably, until the selection changes — NOT a transient 1.6s flash. Drives the
   * stable transcript<->timeline<->flow cross-highlight. Merged with `activeIdx`.
   */
  activeTurnIdxs?: number[]
  /** When false, entries are not clickable (read-only transcript). */
  selectable?: boolean
  /** CRM-dense layout: smaller avatars/text, single column, tighter spacing. */
  compact?: boolean
  /** Override the scroll viewport height/padding classes (parent-controlled). */
  viewportClass?: string
}>()

const emit = defineEmits<{ (e: 'selectTurn', idx: number): void }>()

/** Type guard: a spoken turn (agent | customer) vs an inline action entry. */
function isTurn(entry: TranscriptEntry): entry is TurnEntry {
  return entry.role === 'agent' || entry.role === 'customer'
}
function isAction(entry: TranscriptEntry): entry is ActionEntry {
  return entry.role === 'action'
}

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

/** Map of entry idx -> useAction band membership (start/end for rounded edges). */
const bandMap = computed(() => {
  const m = new Map<number, { start: boolean, end: boolean }>()
  for (const ua of props.useActions ?? []) {
    const [a, b] = ua.entryRange
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    for (let i = lo; i <= hi; i++) {
      m.set(i, { start: i === lo, end: i === hi })
    }
  }
  return m
})

/** Nearest scrollable ancestor of an element (so we scroll the transcript pane,
 *  not the whole window). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement
  while (p) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
    p = p.parentElement
  }
  return null
}

/**
 * Center an entry within the transcript's OWN scroll container — never via
 * `el.scrollIntoView`, which also scrolls every scrollable ancestor up to the
 * window and jumps the whole page when a flow node / finding is selected.
 * Reduced-motion safe.
 */
function scrollTurnIntoView(idx: number) {
  const el = turnRefs.value[idx]
  if (!el) return
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
  const container = scrollParent(el)
  if (!container) return
  const elRect = el.getBoundingClientRect()
  const cRect = container.getBoundingClientRect()
  const delta = (elRect.top - cRect.top) - (cRect.height / 2 - elRect.height / 2)
  container.scrollTo({ top: container.scrollTop + delta, behavior })
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

function speakerLabel(role: 'agent' | 'customer'): string {
  return role === 'agent' ? 'Voice AI' : 'Customer'
}

/** mm:ss start cue for a turn (real GHL turn times, in seconds). */
function timeLabel(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function onTurnClick(idx: number) {
  if (isSelectable.value) emit('selectTurn', idx)
}
</script>

<template>
  <!--
    R3-03: the inner scroll viewport must stay usable on phone, where the call
    header wraps taller. Reserve a larger offset below sm and floor the height so
    the transcript always has a comfortable scrollable area on a 390px screen.
  -->
  <ScrollArea :class="viewportClass ?? 'h-[max(20rem,calc(100svh-19rem))] pr-4 sm:h-[calc(100svh-13rem)]'">
    <div :class="cn('flex flex-col py-1', compact ? 'gap-1.5' : 'gap-4')">
      <template
        v-for="entry in transcript.entries"
        :key="entry.idx"
      >
        <!-- Inline action entry (a tool execution, e.g. end_call). Rendered as a
             centered system marker, not a speech bubble — it is part of the
             real transcript trace but is the agent's machinery, not dialogue. -->
        <div
          v-if="isAction(entry)"
          :ref="(el: unknown) => setTurnRef(entry.idx, el as Element | null)"
          :class="cn(
            'mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-dashed bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground transition-colors duration-[var(--dur)] ease-[var(--ease)]',
            evidenceSet.has(entry.idx) && 'ring-2 ring-warning/70 ring-offset-1 ring-offset-background',
            activeSet.has(entry.idx) && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
            flashSet.has(entry.idx) && 'motion-safe:bg-primary/15',
            bandMap.has(entry.idx) && 'border-l-[3px] border-l-[color:var(--segment)] border-solid'
          )"
        >
          <Wrench class="size-3 shrink-0" />
          <span class="font-mono">#{{ entry.idx }}</span>
          <span class="font-medium text-foreground">{{ entry.toolName }}</span>
          <span class="text-muted-foreground">· {{ entry.toolType }}</span>
          <span class="tabular-nums">{{ timeLabel(entry.atSec) }}</span>
        </div>

        <!-- Spoken turn (agent | customer). -->
        <component
          :is="isSelectable ? 'button' : 'div'"
          v-else-if="isTurn(entry)"
          :ref="(el: unknown) => setTurnRef(entry.idx, el as Element | null)"
          :type="isSelectable ? 'button' : undefined"
          :aria-pressed="isSelectable ? activeSet.has(entry.idx) : undefined"
          :class="cn(
            'flex w-full rounded-lg text-left outline-none',
            compact ? 'gap-2' : 'gap-3',
            isSelectable && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            !compact && entry.role === 'customer' && 'flex-row-reverse'
          )"
          @click="onTurnClick(entry.idx)"
        >
          <div
            :class="cn(
              'flex shrink-0 items-center justify-center rounded-full',
              compact ? 'mt-0.5 size-6' : 'size-8',
              entry.role === 'agent'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            )"
          >
            <component
              :is="entry.role === 'agent' ? Bot : User"
              :class="compact ? 'size-3.5' : 'size-4'"
            />
          </div>

          <div
            :class="cn(
              'flex min-w-0 flex-col gap-1',
              compact ? 'max-w-[calc(100%-2rem)] flex-1' : 'max-w-[calc(100%-2.75rem)] sm:max-w-[82%]',
              !compact && entry.role === 'customer' && 'items-end'
            )"
          >
            <div
              :class="cn(
                'flex items-center gap-2 px-1 text-muted-foreground',
                compact ? 'text-[10px]' : 'text-[11px]'
              )"
            >
              <span class="font-medium">{{ speakerLabel(entry.role) }}</span>
              <span class="font-mono">#{{ entry.idx }}</span>
              <span class="tabular-nums">{{ timeLabel(entry.startSec) }}</span>
            </div>

            <!--
              Bubble highlight language — two semantic tokens + the accent:
                evidence   -> --warning ring  (a finding cites this entry)
                use-action -> --segment left-band (a call segment to action)
                active     -> --primary ring  (PERSISTED selection / cross-highlight)
                flash      -> gentle bg-tint fade, motion-safe only
            -->
            <div
              :class="cn(
                'max-w-full overflow-hidden rounded-md border [overflow-wrap:anywhere] transition-colors duration-[var(--dur)] ease-[var(--ease)]',
                compact ? 'px-2.5 py-1.5 text-[13px] leading-snug' : 'px-3.5 py-2.5 text-sm leading-relaxed',
                entry.role === 'agent'
                  ? 'rounded-tl-sm bg-card'
                  : 'rounded-tr-sm border-transparent bg-secondary text-secondary-foreground',
                bandMap.has(entry.idx) && 'border-l-[3px] border-l-[color:var(--segment)]',
                evidenceSet.has(entry.idx) && 'ring-2 ring-warning/70 ring-offset-1 ring-offset-background',
                activeSet.has(entry.idx) && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                flashSet.has(entry.idx) && 'motion-safe:bg-primary/10'
              )"
            >
              {{ entry.content }}
            </div>

            <!--
              P14: render the band label ONCE, on the band's first entry, so a
              multi-entry use-action range gets one clear annotation instead of
              repeats. The left-band stays on every entry for visual continuity.
            -->
            <span
              v-if="bandMap.get(entry.idx)?.start"
              class="px-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--segment)]"
            >
              Use Action segment
            </span>
          </div>
        </component>
      </template>
    </div>
  </ScrollArea>
</template>
