<script setup lang="ts">
import type { CallListItem, Severity } from '#shared/types'
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, ArrowDownUp, ChevronRight, Inbox, PhoneIncoming, PhoneOutgoing } from 'lucide-vue-next'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/ui/table'
import SeverityBadge from '~/components/SeverityBadge.vue'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

/**
 * CallTable — the shared data table for any list of calls.
 * Used by the Calls inbox (/calls) and the agent detail "Calls needing
 * attention" surface. ~48px comfortable rows, full-row link to /calls/:id,
 * sortable headers with aria-sort, keyboard accessible, empty state.
 */
const props = withDefaults(defineProps<{
  calls: CallListItem[]
  /** Show the agent column (hidden on agent-scoped surfaces). */
  showAgent?: boolean
  /** Compact tier — slightly tighter rows for embedded panels. */
  dense?: boolean
  /** Empty-state copy. */
  emptyTitle?: string
  emptyHint?: string
}>(), {
  showAgent: true,
  dense: false,
  emptyTitle: 'No calls to show',
  emptyHint: 'Sync calls from HighLevel or adjust your filters to see results here.'
})

const { scoreTone } = useTone()

type SortKey = 'contact' | 'agent' | 'outcome' | 'started' | 'findings' | 'severity' | 'score'
const sortKey = ref<SortKey>('started')
const sortAsc = ref(false)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    // text columns default A→Z; numeric/time default high→recent first
    sortAsc.value = key === 'contact' || key === 'agent' || key === 'outcome'
  }
}

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key) return 'none'
  return sortAsc.value ? 'ascending' : 'descending'
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 }

const rows = computed(() => {
  const list = [...props.calls]
  list.sort((a, b) => {
    let av: number | string
    let bv: number | string
    switch (sortKey.value) {
      case 'contact':
        av = (a.call.contactName ?? '').toLowerCase()
        bv = (b.call.contactName ?? '').toLowerCase()
        break
      case 'agent':
        av = a.agentName.toLowerCase()
        bv = b.agentName.toLowerCase()
        break
      case 'outcome':
        av = (a.call.outcome ?? '').toLowerCase()
        bv = (b.call.outcome ?? '').toLowerCase()
        break
      case 'started':
        av = new Date(a.call.startedAt).getTime()
        bv = new Date(b.call.startedAt).getTime()
        break
      case 'findings':
        av = a.findingCount
        bv = b.findingCount
        break
      case 'severity':
        av = a.topSeverity ? SEVERITY_RANK[a.topSeverity] : 0
        bv = b.topSeverity ? SEVERITY_RANK[b.topSeverity] : 0
        break
      case 'score':
        av = a.score ?? -1
        bv = b.score ?? -1
        break
      default:
        av = 0
        bv = 0
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortAsc.value ? cmp : -cmp
  })
  return list
})

const rowHeight = computed(() => (props.dense ? 'h-11' : 'h-12'))

/** SSR-safe relative time — no Intl locale drift between server + client. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffSec = Math.round((Date.now() - then) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 60) return 'just now'
  const mins = Math.round(diffSec / 60)
  if (Math.abs(mins) < 60) return `${mins}m ago`
  const hrs = Math.round(diffSec / 3600)
  if (Math.abs(hrs) < 24) return `${hrs}h ago`
  const days = Math.round(diffSec / 86400)
  if (Math.abs(days) < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (Math.abs(weeks) < 5) return `${weeks}w ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fullTimestamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function contactLabel(item: CallListItem): string {
  return item.call.contactName?.trim() || 'Unknown contact'
}
</script>

<template>
  <div class="overflow-hidden rounded-xl border">
    <Table>
      <TableHeader>
        <TableRow class="bg-muted/40 hover:bg-muted/40">
          <TableHead :aria-sort="ariaSort('contact')">
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('contact')"
            >
              Contact
              <ArrowUp
                v-if="sortKey === 'contact' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'contact'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead
            v-if="showAgent"
            :aria-sort="ariaSort('agent')"
          >
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('agent')"
            >
              Agent
              <ArrowUp
                v-if="sortKey === 'agent' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'agent'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead :aria-sort="ariaSort('outcome')">
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('outcome')"
            >
              Outcome
              <ArrowUp
                v-if="sortKey === 'outcome' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'outcome'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead class="hidden sm:table-cell">
            Direction
          </TableHead>

          <TableHead :aria-sort="ariaSort('started')">
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('started')"
            >
              Started
              <ArrowUp
                v-if="sortKey === 'started' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'started'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead
            class="hidden text-right md:table-cell"
            :aria-sort="ariaSort('findings')"
          >
            <button
              type="button"
              class="ml-auto flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('findings')"
            >
              Findings
              <ArrowUp
                v-if="sortKey === 'findings' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'findings'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead :aria-sort="ariaSort('severity')">
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('severity')"
            >
              Top severity
              <ArrowUp
                v-if="sortKey === 'severity' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'severity'"
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
            :aria-sort="ariaSort('score')"
          >
            <button
              type="button"
              class="ml-auto flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('score')"
            >
              Score
              <ArrowUp
                v-if="sortKey === 'score' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'score'"
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
          v-for="item in rows"
          :key="item.call.id"
          :class="cn('group cursor-pointer', rowHeight)"
        >
          <TableCell class="p-0">
            <NuxtLink
              :to="`/calls/${item.call.id}`"
              :class="cn('flex items-center px-4 font-medium focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2', rowHeight)"
            >
              <span class="truncate">{{ contactLabel(item) }}</span>
            </NuxtLink>
          </TableCell>

          <TableCell
            v-if="showAgent"
            class="text-muted-foreground"
          >
            <span class="truncate">{{ item.agentName }}</span>
          </TableCell>

          <TableCell>
            <span
              v-if="item.call.outcome"
              class="text-sm"
            >{{ item.call.outcome }}</span>
            <span
              v-else
              class="text-sm text-muted-foreground"
            >—</span>
          </TableCell>

          <TableCell class="hidden sm:table-cell">
            <span class="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <PhoneIncoming
                v-if="item.call.direction === 'inbound'"
                class="size-3.5"
              />
              <PhoneOutgoing
                v-else
                class="size-3.5"
              />
              {{ item.call.direction === 'inbound' ? 'Inbound' : 'Outbound' }}
            </span>
          </TableCell>

          <TableCell class="text-muted-foreground">
            <time
              :datetime="item.call.startedAt"
              :title="fullTimestamp(item.call.startedAt)"
              class="text-sm tabular-nums"
            >
              {{ relativeTime(item.call.startedAt) }}
            </time>
          </TableCell>

          <TableCell class="hidden text-right tabular-nums md:table-cell">
            <span :class="item.findingCount ? 'font-medium' : 'text-muted-foreground'">
              {{ item.findingCount }}
            </span>
          </TableCell>

          <TableCell>
            <SeverityBadge
              :severity="item.topSeverity"
              :subtle="!item.topSeverity"
            />
          </TableCell>

          <TableCell class="text-right tabular-nums">
            <span
              v-if="item.score != null"
              :class="cn('font-semibold', scoreTone(item.score))"
            >
              {{ Math.round(item.score) }}
            </span>
            <span
              v-else
              class="text-sm text-muted-foreground"
            >Not scored</span>
          </TableCell>

          <TableCell>
            <ChevronRight class="size-4 text-muted-foreground transition-transform duration-[var(--dur)] ease-[var(--ease)] motion-safe:group-hover:translate-x-0.5" />
          </TableCell>
        </TableRow>

        <TableRow v-if="!rows.length">
          <TableCell
            :colspan="showAgent ? 8 : 7"
            class="h-40"
          >
            <div class="flex flex-col items-center justify-center gap-2 text-center">
              <div class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox class="size-5" />
              </div>
              <p class="text-sm font-semibold">
                {{ emptyTitle }}
              </p>
              <p class="max-w-xs text-sm text-muted-foreground">
                {{ emptyHint }}
              </p>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
