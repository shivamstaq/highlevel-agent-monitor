<script setup lang="ts">
import type { AgentHealth } from '#shared/types'
import { computed, ref } from 'vue'
import { ArrowDownUp, ChevronRight } from 'lucide-vue-next'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/ui/table'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Progress } from '~/components/ui/progress'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/utils'

const props = defineProps<{
  agents: AgentHealth[]
}>()

type SortKey = 'name' | 'avgScore' | 'failureRate' | 'openUseActions'
const sortKey = ref<SortKey>('avgScore')
const sortAsc = ref(false)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = key === 'name'
  }
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

function healthTone(score: number): { label: string, cls: string, bar: string } {
  if (score >= 80) return { label: 'Healthy', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300', bar: 'bg-emerald-500' }
  if (score >= 60) return { label: 'At risk', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300', bar: 'bg-amber-500' }
  return { label: 'Critical', cls: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300', bar: 'bg-red-500' }
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
</script>

<template>
  <div class="overflow-hidden rounded-xl border">
    <Table>
      <TableHeader>
        <TableRow class="bg-muted/40 hover:bg-muted/40">
          <TableHead>
            <button
              class="flex items-center gap-1 font-medium"
              @click="toggleSort('name')"
            >
              Agent <ArrowDownUp class="size-3 text-muted-foreground" />
            </button>
          </TableHead>
          <TableHead>Status</TableHead>
          <TableHead class="w-[200px]">
            <button
              class="flex items-center gap-1 font-medium"
              @click="toggleSort('avgScore')"
            >
              Avg score <ArrowDownUp class="size-3 text-muted-foreground" />
            </button>
          </TableHead>
          <TableHead class="text-right">
            <button
              class="ml-auto flex items-center gap-1 font-medium"
              @click="toggleSort('failureRate')"
            >
              Failures <ArrowDownUp class="size-3 text-muted-foreground" />
            </button>
          </TableHead>
          <TableHead class="text-right">
            <button
              class="ml-auto flex items-center gap-1 font-medium"
              @click="toggleSort('openUseActions')"
            >
              Use-actions <ArrowDownUp class="size-3 text-muted-foreground" />
            </button>
          </TableHead>
          <TableHead class="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in rows"
          :key="row.agent.id"
          class="group cursor-pointer"
          @click="$router.push(`/agents/${row.agent.id}`)"
        >
          <TableCell>
            <div class="flex items-center gap-3">
              <Avatar class="size-9 rounded-lg">
                <AvatarFallback class="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                  {{ initials(row.agent.name) }}
                </AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <div class="truncate font-medium">
                  {{ row.agent.name }}
                </div>
                <div class="truncate text-xs text-muted-foreground">
                  {{ row.agent.goal }}
                </div>
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Badge
              variant="secondary"
              :class="cn('border-transparent font-medium', healthTone(row.avgScore).cls)"
            >
              {{ healthTone(row.avgScore).label }}
            </Badge>
          </TableCell>
          <TableCell>
            <div class="flex items-center gap-2">
              <Progress
                :model-value="row.avgScore"
                class="h-1.5"
                :class="row.callsAnalyzed ? '' : 'opacity-40'"
              />
              <span class="w-9 shrink-0 text-right text-sm font-medium tabular-nums">
                {{ row.callsAnalyzed ? Math.round(row.avgScore) : '—' }}
              </span>
            </div>
          </TableCell>
          <TableCell class="text-right tabular-nums">
            <span :class="row.failureRate > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'">
              {{ Math.round(row.failureRate * 100) }}%
            </span>
          </TableCell>
          <TableCell class="text-right tabular-nums">
            <span
              v-if="row.openUseActions"
              class="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            >
              {{ row.openUseActions }}
            </span>
            <span
              v-else
              class="text-muted-foreground"
            >0</span>
          </TableCell>
          <TableCell>
            <ChevronRight class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
