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
import { humanizeOutcome, relativeTime as relativeTimeFmt } from '~/lib/format'
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

/** SSR-safe relative time — shared formatter (no Intl locale drift). */
function relativeTime(iso: string): string {
  return relativeTimeFmt(iso)
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
  <!--
    R3-01 phone-first reflow: BELOW sm we do NOT render the fixed multi-column
    table (it crushed text + smeared headers + forced h-scroll at 390px).
    Instead each call is a 2-line stacked, full-width row — the whole row a
    NuxtLink to /calls/:id with a visible focus ring, no horizontal scroll.
    At sm+ the data table renders (Direction/Findings/Outcome only at lg).
  -->
  <div class="overflow-hidden rounded-xl border sm:hidden">
    <ul
      v-if="rows.length"
      class="divide-y"
    >
      <li
        v-for="item in rows"
        :key="item.call.id"
      >
        <NuxtLink
          :to="`/calls/${item.call.id}`"
          class="flex items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2 motion-safe:transition-colors active:bg-muted/50"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm font-medium">{{ contactLabel(item) }}</span>
              <span
                v-if="item.score != null"
                :class="cn('shrink-0 text-sm font-semibold tabular-nums', scoreTone(item.score))"
              >{{ Math.round(item.score) }}</span>
              <span
                v-else
                class="shrink-0 text-[12px] text-muted-foreground"
              >Not scored</span>
            </div>
            <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
              <span
                v-if="showAgent"
                class="truncate"
              >{{ item.agentName }}</span>
              <span
                v-if="showAgent"
                aria-hidden="true"
              >·</span>
              <time
                :datetime="item.call.startedAt"
                class="shrink-0 tabular-nums"
              >{{ relativeTime(item.call.startedAt) }}</time>
              <span
                aria-hidden="true"
              >·</span>
              <SeverityBadge
                :severity="item.topSeverity"
                :subtle="!item.topSeverity"
                class="shrink-0"
              />
            </div>
          </div>
          <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </NuxtLink>
      </li>
    </ul>

    <div
      v-else
      class="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center"
    >
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
  </div>

  <div class="hidden overflow-hidden rounded-xl border sm:block">
    <Table fixed>
      <TableHeader>
        <TableRow class="bg-muted/40 hover:bg-muted/40">
          <TableHead
            class="w-[22%] min-w-[140px]"
            :aria-sort="ariaSort('contact')"
          >
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
            class="w-[16%] min-w-[120px]"
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

          <TableHead
            class="hidden w-[15%] min-w-[120px] lg:table-cell"
            :aria-sort="ariaSort('outcome')"
          >
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

          <TableHead class="hidden w-[120px] lg:table-cell">
            Direction
          </TableHead>

          <TableHead
            class="w-[104px]"
            :aria-sort="ariaSort('started')"
          >
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
            class="hidden w-[88px] text-right lg:table-cell"
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

          <TableHead
            class="w-[120px]"
            :aria-sort="ariaSort('severity')"
          >
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
            class="w-[96px] text-right"
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
          :class="cn('group relative cursor-pointer', rowHeight)"
        >
          <TableCell class="max-w-0">
            <!--
              R3-06: full-row click-through via a stretched-link overlay. ONE
              NuxtLink per row (one tab stop, keyboard + SR reachable) is
              absolutely positioned to cover the entire row; its focus-visible
              ring draws on the whole row. Cells with their own interactive
              content (none here) would need relative+z to sit above it.
            -->
            <NuxtLink
              :to="`/calls/${item.call.id}`"
              :aria-label="`Open call · ${contactLabel(item)}`"
              class="absolute inset-0 z-0 rounded-md focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2"
            />
            <span
              class="block truncate font-medium"
              :title="contactLabel(item)"
            >{{ contactLabel(item) }}</span>
          </TableCell>

          <TableCell
            v-if="showAgent"
            class="max-w-0 text-muted-foreground"
          >
            <span
              class="block truncate"
              :title="item.agentName"
            >{{ item.agentName }}</span>
          </TableCell>

          <TableCell class="hidden max-w-0 lg:table-cell">
            <span
              v-if="item.call.outcome"
              class="block truncate text-sm"
              :title="humanizeOutcome(item.call.outcome)"
            >{{ humanizeOutcome(item.call.outcome) }}</span>
            <span
              v-else
              class="text-sm text-muted-foreground"
            >—</span>
          </TableCell>

          <TableCell class="hidden lg:table-cell">
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

          <TableCell class="hidden text-right tabular-nums lg:table-cell">
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
