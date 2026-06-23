<!-- CREATED (our eval layer) — the shared call list table, bound to the new
     CallListItem contract (createdAt / callType / flowAdherence). -->
<script setup lang="ts">
import type { CallListItem, Severity } from '#shared/types'
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, ArrowDownUp, ChevronRight, FlaskConical, Inbox, Radio } from 'lucide-vue-next'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/ui/table'
import { Badge } from '~/components/ui/badge'
import SeverityBadge from '~/components/SeverityBadge.vue'
import { useTone } from '~/composables/useTone'
import { relativeTime as relativeTimeFmt } from '~/lib/format'
import { cn } from '~/lib/utils'

/**
 * CallTable — the shared data table for any list of calls.
 * Used by the Calls inbox (/calls) and the agent detail "Calls needing
 * attention" surface. ~48px comfortable rows, full-row link to /calls/:id,
 * sortable headers with aria-sort, keyboard accessible, empty state.
 *
 * Columns come from CallListItem (contract): the call's createdAt, duration,
 * callType (LIVE|TRIAL), top finding severity, flow conformance, and QA score.
 * There is no contact/direction/outcome on the call anymore — calls are keyed
 * by their time + agent + type.
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

type SortKey = 'agent' | 'type' | 'created' | 'duration' | 'findings' | 'severity' | 'conformance' | 'score'
const sortKey = ref<SortKey>('created')
const sortAsc = ref(false)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    // text columns default A→Z; numeric/time default high→recent first
    sortAsc.value = key === 'agent' || key === 'type'
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
      case 'agent':
        av = a.agentName.toLowerCase()
        bv = b.agentName.toLowerCase()
        break
      case 'type':
        av = a.call.callType
        bv = b.call.callType
        break
      case 'created':
        av = new Date(a.call.createdAt).getTime()
        bv = new Date(b.call.createdAt).getTime()
        break
      case 'duration':
        av = a.call.durationSec
        bv = b.call.durationSec
        break
      case 'findings':
        av = a.findingCount
        bv = b.findingCount
        break
      case 'severity':
        av = a.topSeverity ? SEVERITY_RANK[a.topSeverity] : 0
        bv = b.topSeverity ? SEVERITY_RANK[b.topSeverity] : 0
        break
      case 'conformance':
        av = a.flowAdherence ?? -1
        bv = b.flowAdherence ?? -1
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

/** m:ss duration label (matches the call header). */
function fmtDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <!--
    R3-01 phone-first reflow: BELOW sm we do NOT render the fixed multi-column
    table (it crushed text + smeared headers + forced h-scroll at 390px).
    Instead each call is a 2-line stacked, full-width row — the whole row a
    NuxtLink to /calls/:id with a visible focus ring, no horizontal scroll.
    At sm+ the data table renders (Findings/Conformance only at lg).
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
              <span class="flex min-w-0 items-center gap-2">
                <Badge
                  variant="outline"
                  :class="cn(
                    'shrink-0 gap-1 rounded-md px-1.5 py-0 text-[11px] font-medium',
                    item.call.callType === 'LIVE' ? 'border-primary/40 text-primary' : 'text-muted-foreground'
                  )"
                >
                  <component
                    :is="item.call.callType === 'LIVE' ? Radio : FlaskConical"
                    class="size-3"
                  />
                  {{ item.call.callType === 'LIVE' ? 'Live' : 'Trial' }}
                </Badge>
                <span
                  v-if="showAgent"
                  class="truncate text-sm font-medium"
                >{{ item.agentName }}</span>
              </span>
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
              <time
                :datetime="item.call.createdAt"
                class="shrink-0 tabular-nums"
              >{{ relativeTime(item.call.createdAt) }}</time>
              <span aria-hidden="true">·</span>
              <span class="shrink-0 tabular-nums">{{ fmtDuration(item.call.durationSec) }}</span>
              <span aria-hidden="true">·</span>
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
            v-if="showAgent"
            class="w-[22%] min-w-[140px]"
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
            class="w-[100px]"
            :aria-sort="ariaSort('type')"
          >
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('type')"
            >
              Type
              <ArrowUp
                v-if="sortKey === 'type' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'type'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead
            class="w-[104px]"
            :aria-sort="ariaSort('created')"
          >
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('created')"
            >
              Created
              <ArrowUp
                v-if="sortKey === 'created' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'created'"
                class="size-3 text-primary"
              />
              <ArrowDownUp
                v-else
                class="size-3 text-muted-foreground"
              />
            </button>
          </TableHead>

          <TableHead
            class="w-[92px]"
            :aria-sort="ariaSort('duration')"
          >
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('duration')"
            >
              Duration
              <ArrowUp
                v-if="sortKey === 'duration' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'duration'"
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
            class="hidden w-[116px] text-right lg:table-cell"
            :aria-sort="ariaSort('conformance')"
          >
            <button
              type="button"
              class="ml-auto flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              @click="toggleSort('conformance')"
            >
              Flow
              <ArrowUp
                v-if="sortKey === 'conformance' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'conformance'"
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
          <TableCell
            v-if="showAgent"
            class="max-w-0"
          >
            <!--
              R3-06: full-row click-through via a stretched-link overlay. ONE
              NuxtLink per row (one tab stop, keyboard + SR reachable) is
              absolutely positioned to cover the entire row; its focus-visible
              ring draws on the whole row.
            -->
            <NuxtLink
              :to="`/calls/${item.call.id}`"
              :aria-label="`Open call · ${item.agentName} · ${relativeTime(item.call.createdAt)}`"
              class="absolute inset-0 z-0 rounded-md focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2"
            />
            <span
              class="block truncate font-medium"
              :title="item.agentName"
            >{{ item.agentName }}</span>
          </TableCell>

          <TableCell :class="cn('relative', !showAgent && 'pl-4')">
            <!-- When the agent column is hidden, the stretched link lives here. -->
            <NuxtLink
              v-if="!showAgent"
              :to="`/calls/${item.call.id}`"
              :aria-label="`Open call · ${relativeTime(item.call.createdAt)}`"
              class="absolute inset-0 z-0 rounded-md focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2"
            />
            <Badge
              variant="outline"
              :class="cn(
                'gap-1 rounded-md text-[12px] font-medium',
                item.call.callType === 'LIVE' ? 'border-primary/40 text-primary' : 'text-muted-foreground'
              )"
            >
              <component
                :is="item.call.callType === 'LIVE' ? Radio : FlaskConical"
                class="size-3"
              />
              {{ item.call.callType === 'LIVE' ? 'Live' : 'Trial' }}
            </Badge>
          </TableCell>

          <TableCell class="text-muted-foreground">
            <time
              :datetime="item.call.createdAt"
              :title="fullTimestamp(item.call.createdAt)"
              class="text-sm tabular-nums"
            >
              {{ relativeTime(item.call.createdAt) }}
            </time>
          </TableCell>

          <TableCell class="text-muted-foreground tabular-nums">
            {{ fmtDuration(item.call.durationSec) }}
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

          <TableCell class="hidden text-right tabular-nums lg:table-cell">
            <span
              v-if="item.flowAdherence != null"
              :class="cn('font-medium', scoreTone(item.flowAdherence))"
            >{{ Math.round(item.flowAdherence) }}</span>
            <span
              v-else
              class="text-sm text-muted-foreground"
            >—</span>
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
