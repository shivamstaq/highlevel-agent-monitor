<!-- CREATED (write-back flywheel) — git-style unified diff renderer.
     Drives the recommendation review slide-over + the changes queue. -->
<script setup lang="ts">
import { computed } from 'vue'
import type { DiffHunk, RichLine } from '#shared/diff'
import { enrichHunk } from '#shared/diff'

const props = withDefaults(defineProps<{
  hunks: DiffHunk[]
  /** Show the @@ hunk headers (git style). Off for very short single-hunk diffs. */
  showHeaders?: boolean
}>(), { showHeaders: true })

const richHunks = computed<{ header: string, lines: RichLine[] }[]>(() =>
  props.hunks.map(h => ({ header: h.header, lines: enrichHunk(h) }))
)

const empty = computed(() => props.hunks.length === 0 || props.hunks.every(h => h.lines.every(l => l.type === 'context')))

function gutter(n: number | null): string {
  return n === null ? '' : String(n)
}
</script>

<template>
  <div class="overflow-hidden rounded-md border bg-card font-mono text-[12px] leading-relaxed">
    <p
      v-if="empty"
      class="px-3 py-2 text-muted-foreground"
    >
      No textual change.
    </p>
    <template
      v-for="(hunk, hi) in richHunks"
      :key="hi"
    >
      <div
        v-if="showHeaders"
        class="border-y bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground select-none"
      >
        {{ hunk.header }}
      </div>
      <div
        v-for="(line, li) in hunk.lines"
        :key="`${hi}-${li}`"
        :class="[
          'flex items-stretch whitespace-pre-wrap break-words',
          line.type === 'add' && 'bg-emerald-500/10',
          line.type === 'del' && 'bg-rose-500/10'
        ]"
      >
        <!-- Single compact gutter (new line no., or old for deletions) — two full
             gutters wasted ~30% of width in the narrow GHL embed. -->
        <span class="w-7 shrink-0 select-none border-r px-1 text-right text-muted-foreground/60 tabular-nums">{{ gutter(line.newNo ?? line.oldNo) }}</span>
        <span
          :class="[
            'w-4 shrink-0 select-none px-1 text-center',
            line.type === 'add' && 'text-emerald-600 dark:text-emerald-400',
            line.type === 'del' && 'text-rose-600 dark:text-rose-400',
            line.type === 'context' && 'text-muted-foreground/40'
          ]"
        >{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</span>
        <span class="min-w-0 flex-1 px-2 text-foreground/90"><span
          v-for="(seg, si) in line.segs"
          :key="si"
          :class="seg.changed && line.type === 'add' && 'rounded-sm bg-emerald-500/30 font-medium'
            || seg.changed && line.type === 'del' && 'rounded-sm bg-rose-500/30 font-medium'
            || ''"
        >{{ seg.text }}</span></span>
      </div>
    </template>
  </div>
</template>
