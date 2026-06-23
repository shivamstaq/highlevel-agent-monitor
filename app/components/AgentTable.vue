<script setup lang="ts">
// CREATED (our eval layer) — the shared agent roster table over the flat AgentHealth contract.
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
 *
 * Bound to the rebuilt FLAT AgentHealth contract: agentId / agentName (no nested
 * `agent` object, no `goal`). "Flow adherence" = mean conformance (avgFlowAdherence).
 */
const props = defineProps<{
  agents: AgentHealth[]
}>()

const { scoreToneSet, scoreToneName, scoreBandLabel, toneClasses } = useTone()

type SortKey = 'name' | 'avgScore' | 'avgFlowAdherence' | 'failureRate' | 'openUseActions'
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
      av = a.agentName.toLowerCase()
      bv = b.agentName.toLowerCase()
    } else if (sortKey.value === 'avgFlowAdherence') {
      // null Flow adherence (no flow baseline) sorts below any real value.
      av = a.avgFlowAdherence ?? -1
      bv = b.avgFlowAdherence ?? -1
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

/** Compact secondary line under the agent name (no `goal` in the flat contract). */
function subtitle(a: AgentHealth): string {
  if (!a.callsAnalyzed) return 'No calls analyzed yet'
  const calls = `${a.callsAnalyzed} call${a.callsAnalyzed === 1 ? '' : 's'} analyzed`
  return a.criteriaMetRate != null
    ? `${calls} · ${Math.round(a.criteriaMetRate * 100)}% criteria met`
    : calls
}
</script>

<template>
  <!--
    R3-03 phone-first reflow: BELOW sm we do NOT render the fixed multi-column
    roster (comparison metrics hid behind h-scroll). Each agent becomes a 2-line
    stacked, full-width row — the whole row a NuxtLink to /agents/:id with a
    visible focus ring — so Avg score / Flow adherence / failures stay visible.
  -->
  <div class="overflow-hidden rounded-xl border sm:hidden">
    <ul
      v-if="rows.length"
      class="divide-y"
    >
      <li
        v-for="row in rows"
        :key="row.agentId"
      >
        <NuxtLink
          :to="`/agents/${row.agentId}`"
          class="flex items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2 motion-safe:transition-colors active:bg-muted/50"
        >
          <Avatar class="size-9 shrink-0 rounded-full">
            <AvatarFallback class="rounded-full bg-primary/10 text-[12px] font-semibold text-primary">
              {{ initials(row.agentName) }}
            </AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm font-semibold">{{ row.agentName }}</span>
              <span
                :class="cn('shrink-0 text-sm font-semibold tabular-nums', row.callsAnalyzed ? scoreToneSet(row.avgScore).text : 'text-muted-foreground')"
              >{{ row.callsAnalyzed ? Math.round(row.avgScore) : '—' }}</span>
            </div>
            <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground">
              <span
                :class="cn(
                  'shrink-0 font-medium',
                  row.callsAnalyzed ? scoreToneSet(row.avgScore).text : 'text-muted-foreground'
                )"
              >{{ row.callsAnalyzed ? scoreBandLabel(row.avgScore) : 'No data' }}</span>
              <span aria-hidden="true">·</span>
              <span class="shrink-0">
                Flow
                <span
                  v-if="row.avgFlowAdherence != null"
                  :class="cn('font-medium tabular-nums', toneClasses(scoreToneName(row.avgFlowAdherence)).text)"
                >{{ Math.round(row.avgFlowAdherence) }}</span>
                <span v-else>—</span>
              </span>
              <span aria-hidden="true">·</span>
              <span class="shrink-0 tabular-nums">
                {{ Math.round(row.failureRate * 100) }}% fail
              </span>
              <template v-if="row.openUseActions">
                <span aria-hidden="true">·</span>
                <span class="shrink-0 tabular-nums">{{ row.openUseActions }} use actions</span>
              </template>
            </div>
          </div>
          <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </NuxtLink>
      </li>
    </ul>

    <div
      v-else
      class="px-4 py-10 text-center text-sm text-muted-foreground"
    >
      No agents to show yet.
    </div>
  </div>

  <div class="hidden overflow-hidden rounded-xl border sm:block">
    <Table fixed>
      <colgroup>
        <!-- Agent (text, flexes) · Status · Avg score · Flow adherence · Failures · Use actions · chevron -->
        <col class="w-[34%] min-w-[180px]">
        <col class="w-[96px]">
        <col class="w-[168px]">
        <col class="w-[148px]">
        <col class="w-[88px]">
        <col class="w-[104px]">
        <col class="w-8">
      </colgroup>
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

          <TableHead :aria-sort="ariaSort('avgScore')">
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

          <TableHead :aria-sort="ariaSort('avgFlowAdherence')">
            <button
              type="button"
              class="flex items-center gap-1 rounded-md font-medium focus-visible:outline-2 focus-visible:outline-primary"
              :title="'Flow adherence: how closely each agent\'s calls followed their expected flow.'"
              @click="toggleSort('avgFlowAdherence')"
            >
              Flow adherence
              <ArrowUp
                v-if="sortKey === 'avgFlowAdherence' && sortAsc"
                class="size-3 text-primary"
              />
              <ArrowDown
                v-else-if="sortKey === 'avgFlowAdherence'"
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
          :key="row.agentId"
          class="group relative h-12 cursor-pointer"
        >
          <TableCell>
            <!--
              R3-06: full-row click-through via a stretched-link overlay. ONE
              NuxtLink per row (one tab stop, keyboard + SR reachable) covers the
              whole row so Status/Avg score/Flow adherence/Failures cells are all
              part of the activation target, not just the first cell.
            -->
            <NuxtLink
              :to="`/agents/${row.agentId}`"
              :aria-label="`Open agent · ${row.agentName}`"
              class="absolute inset-0 z-0 rounded-md focus-visible:outline-2 focus-visible:outline-primary -outline-offset-2"
            />
            <div class="flex items-center gap-3">
              <Avatar class="size-9 shrink-0 rounded-full">
                <AvatarFallback class="rounded-full bg-primary/10 text-[12px] font-semibold text-primary">
                  {{ initials(row.agentName) }}
                </AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold">
                  {{ row.agentName }}
                </div>
                <div
                  class="truncate text-[12px] text-muted-foreground"
                  :title="subtitle(row)"
                >
                  {{ subtitle(row) }}
                </div>
              </div>
            </div>
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
                :aria-label="`Average score for ${row.agentName}`"
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

          <TableCell>
            <div
              v-if="row.avgFlowAdherence != null"
              class="flex items-center gap-2"
            >
              <div
                class="h-1.5 w-full overflow-hidden rounded-full"
                :class="toneClasses(scoreToneName(row.avgFlowAdherence)).bg"
                role="progressbar"
                :aria-valuenow="Math.round(row.avgFlowAdherence)"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="`Flow adherence for ${row.agentName}`"
              >
                <div
                  class="h-full rounded-full"
                  :class="toneClasses(scoreToneName(row.avgFlowAdherence)).dot"
                  :style="`width: ${Math.max(2, Math.round(row.avgFlowAdherence))}%`"
                />
              </div>
              <span
                class="w-9 shrink-0 text-right text-sm font-semibold tabular-nums"
                :class="toneClasses(scoreToneName(row.avgFlowAdherence)).text"
              >
                {{ Math.round(row.avgFlowAdherence) }}
              </span>
            </div>
            <span
              v-else
              class="text-sm text-muted-foreground"
              title="No flow baseline for this agent's calls yet."
            >—</span>
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
            :colspan="7"
            class="h-32 text-center text-sm text-muted-foreground"
          >
            No agents to show yet.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
