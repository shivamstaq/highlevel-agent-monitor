<!-- CREATED (write-back flywheel) — audit log of changes pushed to live agents,
     with 1-click revert for applied changes. -->
<script setup lang="ts">
import { ref } from 'vue'
import { History, Loader2, Undo2, CircleCheck, RotateCcw } from 'lucide-vue-next'
import type { ChangeEvent } from '#shared/types'
import SectionCard from '~/components/SectionCard.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { relativeTime } from '~/lib/format'

const props = defineProps<{ changes: ChangeEvent[] }>()
const emit = defineEmits<{ changed: [] }>()

const { revertChange } = useApi()
const revertingId = ref<string | null>(null)
// Revert is a live write → 2-step confirm (click → confirm), consistent with cards.
const confirmId = ref<string | null>(null)

async function revert(c: ChangeEvent) {
  if (confirmId.value !== c.id) {
    confirmId.value = c.id
    setTimeout(() => {
      if (confirmId.value === c.id) confirmId.value = null
    }, 4000)
    return
  }
  confirmId.value = null
  revertingId.value = c.id
  try {
    await revertChange(c.agentId, c.id)
    emit('changed')
  } finally {
    revertingId.value = null
  }
}

/** The relevant timestamp + verb per row: applied rows show when applied, reverted
 *  rows show when reverted (an audit log must not mislabel a revert as an apply). */
function stamp(c: ChangeEvent): { verb: string, at: string } {
  return c.status === 'reverted' && c.revertedAt
    ? { verb: 'reverted', at: c.revertedAt }
    : { verb: 'applied', at: c.appliedAt }
}
</script>

<template>
  <SectionCard v-if="props.changes.length">
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <History class="size-4 text-muted-foreground" />
        <h2 class="text-[15px] font-semibold tracking-tight">
          Change history
        </h2>
        <span class="rounded-full bg-muted px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted-foreground">
          {{ props.changes.length }}
        </span>
      </div>

      <ul class="flex flex-col divide-y">
        <li
          v-for="c in props.changes"
          :key="c.id"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
        >
          <Badge
            :class="c.status === 'applied'
              ? 'gap-1 rounded-md border-transparent bg-emerald-500/15 text-[11px] text-emerald-700 dark:text-emerald-300'
              : 'gap-1 rounded-md border-transparent bg-muted text-[11px] text-muted-foreground'"
          >
            <component
              :is="c.status === 'applied' ? CircleCheck : RotateCcw"
              class="size-3"
            />
            {{ c.status === 'applied' ? 'Applied' : 'Reverted' }}
          </Badge>
          <span class="min-w-0 flex-1 truncate text-sm">
            <span class="font-medium">{{ c.title ?? c.label }}</span>
            <span class="text-muted-foreground"> · {{ c.label }}</span>
            <span
              v-if="c.agentName"
              class="text-muted-foreground"
            > · {{ c.agentName }}</span>
            <span
              v-if="c.edited"
              class="text-muted-foreground"
            > · edited</span>
          </span>
          <span
            class="text-[12px] tabular-nums text-muted-foreground"
            :title="stamp(c).at"
          >{{ stamp(c).verb }} {{ relativeTime(stamp(c).at) }}</span>
          <Button
            v-if="c.status === 'applied'"
            :variant="confirmId === c.id ? 'destructive' : 'outline'"
            size="sm"
            class="gap-1.5"
            :disabled="revertingId === c.id"
            @click="revert(c)"
          >
            <Loader2
              v-if="revertingId === c.id"
              class="size-3.5 animate-spin"
            />
            <Undo2
              v-else
              class="size-3.5"
            />
            {{ confirmId === c.id ? 'Confirm' : 'Revert' }}
          </Button>
        </li>
      </ul>
    </div>
  </SectionCard>
</template>
