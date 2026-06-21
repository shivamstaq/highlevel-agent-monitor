<script setup lang="ts">
import type { AgentHealth } from '#shared/types'
import { computed, ref } from 'vue'
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronRight } from 'lucide-vue-next'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/ui/table'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

/**
 * AgentTable — the shared roster data table (Overview preview + /agents).
 * ~48px comfortable rows, full-row NuxtLink drill-down (keyboard reachable),
 * sortable headers with aria-sort + directional arrows, status bars/badges
 * routed through useTone (no raw emerald-/amber-/red-NNN utilities).
 */
const props = defineProps<{
  agents: AgentHealth[]
}>()

const { scoreToneSet, scoreBandLabel, toneClasses } = useTone()

type SortKey = 'name' | 'avgScore' | 'failureRate' | 'openUseActions'
const sortKey = ref<SortKey>('avgScore')
const sortAsc = ref(false)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    // text column defaults A→Z; numeric columns default high→low first
    sortAsc.value = key === 'name'
  }
}

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key) return 'none'
  return sortAsc.value ? 'ascending' : 'descending'
}

const rows = computed(() => {
  const list = [...props.agents]
  list.sort((a, b) => {
    let av: number | string
    let bv: number | string
    if (sortKey.value === 'name') {
      av = a.agent.name.toLowerCase()
      bv = b.agent.name.toLowerCase()
    } else {
      av = a[sortKey.value]
      bv = b[sortKey.value]
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortAsc.value ? cmp : -cmp
  })
  return list
})

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

/** Failure-rate tone: any failures = danger foreground, else neutral. */
function failureClass(rate: number): string {
  return rate > 0 ? toneClasses('danger').text : 'text-muted-foreground'
}
</script>

<template>
  <div class="overflow-hidden rounded-xl border">
    <Table>
      <TableHeader>
        <TableRow class="bg-muted/40 hover:bg-muted/40">
          <TableHead :aria-sort="ariaSort('name')">
            <button
              type="button"
              :class="cn(
                'flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary',
                sortKey === 'name' ? 'text-foreground' : 'text-muted-foreground'
              )"
              @click="toggleSort('name')"
            >
              <span class="text-foreground">Agent</span>
              <ArrowUp
                v-if="sortKey === 'name' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'name'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead>Status</TableHead>

          <TableHead
            class="w-[200px]"
            :aria-sort="ariaSort('avgScore')"
          >
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('avgScore')"
            >
              Avg score
              <ArrowUp
                v-if="sortKey === 'avgScore' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'avgScore'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead
            class="text-right"
            :aria-sort="ariaSort('failureRate')"
          >
            <button
              type="button"
              class="ml-auto flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('failureRate')"
            >
              Failures
              <ArrowUp
                v-if="sortKey === 'failureRate' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'failureRate'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead
            class="text-right"
            :aria-sort="ariaSort('openUseActions')"
          >
            <button
              type="button"
              class="ml-auto flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('openUseActions')"
            >
              Use actions
              <ArrowUp
                v-if="sortKey === 'openUseActions' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'openUseActions'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead class="w-8" />
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow
          v-for="row in rows"
          :key="row.agent.id"
          class="group h-12 cursor-pointer"
        >
          <TableCell class="p-0">
            <NuxtLink
              :to="`/agents/${row.agent.id}`"
              :class="cn(
                'flex h-12 items-center gap-3 px-4 focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2'
              )"
            >
              <Avatar class="size-9 shrink-0 rounded-full">
                <AvatarFallback class="rounded-full bg-primary/10 text-[12px] font-semibold text-primary">
                  {{ initials(row.agent.name) }}
                </AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold">
                  {{ row.agent.name }}
                </div>
                <div
                  class="truncate text-[12px] text-muted-foreground"
                  :title="row.agent.goal"
                >
                  {{ row.agent.goal }}
                </div>
              </div>
            </NuxtLink>
          </TableCell>

          <TableCell>
            <Badge
              variant="secondary"
              :class="cn(
                'rounded-full border-transparent text-[12px] font-medium',
                row.callsAnalyzed ? scoreToneSet(row.avgScore).badge : 'bg-muted text-muted-foreground'
              )"
            >
              {{ row.callsAnalyzed ? scoreBandLabel(row.avgScore) : 'No data' }}
            </Badge>
          </TableCell>

          <TableCell>
            <div class="flex items-center gap-2">
              <div
                class="h-1.5 w-full overflow-hidden rounded-full"
                :class="row.callsAnalyzed ? scoreToneSet(row.avgScore).bg : 'bg-muted'"
                role="progressbar"
                :aria-valuenow="row.callsAnalyzed ? Math.round(row.avgScore) : 0"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="`Average score for ${row.agent.name}`"
              >
                <div
                  v-if="row.callsAnalyzed"
                  class="h-full rounded-full"
                  :class="scoreToneSet(row.avgScore).dot"
                  :style="`width: ${Math.max(2, Math.round(row.avgScore))}%`"
                />
              </div>
              <span
                class="w-9 shrink-0 text-right text-sm font-semibold tabular-nums"
                :class="row.callsAnalyzed ? scoreToneSet(row.avgScore).text : 'text-muted-foreground'"
              >
                {{ row.callsAnalyzed ? Math.round(row.avgScore) : '—' }}
              </span>
            </div>
          </TableCell>

          <TableCell class="text-right tabular-nums">
            <span :class="cn('text-sm', row.failureRate > 0 ? cn('font-medium', failureClass(row.failureRate)) : 'text-muted-foreground')">
              {{ Math.round(row.failureRate * 100) }}%
            </span>
          </TableCell>

          <TableCell class="text-right tabular-nums">
            <span
              v-if="row.openUseActions"
              :class="cn('inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold', toneClasses('warning').badge)"
            >
              {{ row.openUseActions }}
            </span>
            <span
              v-else
              class="text-sm text-muted-foreground"
            >0</span>
          </TableCell>

          <TableCell>
            <ChevronRight class="size-4 text-muted-foreground transition-transform duration-[var(--dur)] ease-[var(--ease)] motion-safe:group-hover:translate-x-0.5" />
          </TableCell>
        </TableRow>

        <TableRow v-if="!rows.length">
          <TableCell
            :colspan="6"
            class="h-32 text-center text-sm text-muted-foreground"
          >
            No agents to show yet.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
