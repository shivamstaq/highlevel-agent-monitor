<script setup lang="ts">
import type { Transcript, UseAction } from '#shared/types'
import { computed, ref, watch } from 'vue'
import { Bot, User } from 'lucide-vue-next'
import { ScrollArea } from '~/components/ui/scroll-area'
import { cn } from '~/lib/utils'

const props = defineProps<{
  transcript: Transcript
  /** Indices that any finding cites — get a persistent subtle ring. */
  evidenceIdxs?: number[]
  /** Use-actions paint a colored band across their turn range. */
  useActions?: UseAction[]
  /** Turns to flash + scroll to when a finding is selected. */
  flashIdxs?: number[]
}>()

const turnRefs = ref<Record<number, HTMLElement | null>>({})
function setTurnRef(idx: number, el: Element | null) {
  turnRefs.value[idx] = el as HTMLElement | null
}

const evidenceSet = computed(() => new Set(props.evidenceIdxs ?? []))
const flashSet = ref<Set<number>>(new Set())

/** Map of turn idx -> useAction band membership (start/mid/end for rounded edges). */
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

watch(() => props.flashIdxs, (idxs) => {
  if (!idxs || !idxs.length) return
  flashSet.value = new Set(idxs)
  const first = Math.min(...idxs)
  const el = turnRefs.value[first]
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => {
    flashSet.value = new Set()
  }, 1800)
})

function speakerLabel(s: string): string {
  return s === 'agent' ? 'Voice AI' : 'Customer'
}
</script>

<template>
  <ScrollArea class="h-[calc(100svh-13rem)] pr-4">
    <div class="flex flex-col gap-4 py-1">
      <div
        v-for="turn in transcript.turns"
        :key="turn.idx"
        :ref="(el: unknown) => setTurnRef(turn.idx, el as Element | null)"
        :class="cn(
          'flex gap-3',
          turn.speaker === 'customer' && 'flex-row-reverse'
        )"
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

          <div
            :class="cn(
              'rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed transition-all duration-300',
              turn.speaker === 'agent'
                ? 'rounded-tl-sm bg-card'
                : 'rounded-tr-sm bg-primary text-primary-foreground border-transparent',
              evidenceSet.has(turn.idx) && 'ring-2 ring-amber-400/70 ring-offset-1 ring-offset-background',
              flashSet.has(turn.idx) && 'ring-2 ring-primary scale-[1.01] shadow-md',
              bandMap.has(turn.idx) && 'border-l-4 border-l-violet-400 dark:border-l-violet-500'
            )"
          >
            {{ turn.text }}
          </div>

          <span
            v-if="bandMap.has(turn.idx)"
            class="px-1 text-[10px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400"
          >
            Use-action segment
          </span>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
