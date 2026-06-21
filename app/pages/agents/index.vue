<script setup lang="ts">
import type { AgentHealth } from '#shared/types'
import { computed, ref } from 'vue'
import { PlusCircle, Search, Users, X } from 'lucide-vue-next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/ui/select'
import { Input } from '~/components/ui/input'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Skeleton } from '~/components/ui/skeleton'
import SectionCard from '~/components/SectionCard.vue'
import AgentTable from '~/components/AgentTable.vue'
import { useApi } from '~/composables/useApi'
import { useTone } from '~/composables/useTone'
import { useBreadcrumb } from '~/composables/useBreadcrumb'

/**
 * Agents list (/agents) — the destination representing "the agents I manage".
 * Full-width roster reusing the shared AgentTable (sortable, ~48px rows,
 * full-row drill-down to /agents/:id, keyboard reachable). Adds a search box,
 * a status filter (healthy / at risk / critical / no data), and a header
 * "New agent" action. Loading + empty + error states are all handled.
 */
const { getFleet } = useApi()
const { scoreToneName } = useTone()
const { setBreadcrumb } = useBreadcrumb()

useHead({ title: 'Agents · Voice AI Copilot' })
setBreadcrumb([{ label: 'Agents' }])

const { data: fleet, pending, error, refresh } = await useAsyncData('agents-roster', () => getFleet())

const agents = computed<AgentHealth[]>(() => fleet.value?.agents ?? [])

/* ----------------------------------------------------------------------------
 * Search + status filter (client-side over the fleet roster).
 * ------------------------------------------------------------------------- */
const search = ref('')

type StatusFilter = 'all' | 'success' | 'warning' | 'danger' | 'no_data'
const status = ref<StatusFilter>('all')

const STATUS_OPTIONS: { value: StatusFilter, label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Healthy' },
  { value: 'warning', label: 'At risk' },
  { value: 'danger', label: 'Critical' },
  { value: 'no_data', label: 'No data yet' }
]

/** A roster row's status band — neutral until it has analyzed calls. */
function statusOf(a: AgentHealth): StatusFilter {
  if (!a.callsAnalyzed) return 'no_data'
  const tone = scoreToneName(a.avgScore)
  return tone === 'neutral' ? 'no_data' : tone
}

const filtered = computed<AgentHealth[]>(() => {
  const q = search.value.trim().toLowerCase()
  return agents.value.filter((a) => {
    if (status.value !== 'all' && statusOf(a) !== status.value) return false
    if (!q) return true
    return (
      a.agent.name.toLowerCase().includes(q)
      || a.agent.goal.toLowerCase().includes(q)
    )
  })
})

const hasAgents = computed(() => agents.value.length > 0)
const noResults = computed(() => hasAgents.value && filtered.value.length === 0)

function clearFilters() {
  search.value = ''
  status.value = 'all'
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-4 md:p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">
          Agents
        </h1>
        <p class="text-sm text-muted-foreground">
          Every Voice AI agent monitored in your location.
        </p>
      </div>
      <Button
        as-child
        size="sm"
      >
        <NuxtLink to="/agents/new">
          <PlusCircle class="size-4" /> New agent
        </NuxtLink>
      </Button>
    </div>

    <!-- Error -->
    <Alert
      v-if="error"
      variant="destructive"
    >
      <AlertTitle>Couldn't load agents</AlertTitle>
      <AlertDescription>
        <p>{{ error.statusMessage || error.message || 'The request failed before it reached the server.' }}</p>
        <Button
          variant="outline"
          size="sm"
          class="mt-2 w-fit"
          @click="() => refresh()"
        >
          Try again
        </Button>
      </AlertDescription>
    </Alert>

    <!-- Loading -->
    <template v-else-if="pending">
      <Skeleton class="h-10 w-full max-w-md rounded-md" />
      <Skeleton class="h-[420px] rounded-xl" />
    </template>

    <!-- Empty fleet -->
    <SectionCard
      v-else-if="!hasAgents"
      class="border-dashed"
    >
      <div class="flex flex-col items-center justify-center gap-4 py-14 text-center">
        <div class="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users class="size-7" />
        </div>
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">
            No agents yet
          </h2>
          <p class="mx-auto max-w-sm text-sm text-muted-foreground">
            Create your first agent and we'll derive its success criteria and expected call flow, then start scoring its calls.
          </p>
        </div>
        <Button as-child>
          <NuxtLink to="/agents/new">
            <PlusCircle class="size-4" /> New agent
          </NuxtLink>
        </Button>
      </div>
    </SectionCard>

    <!-- Roster -->
    <template v-else>
      <!-- Filter bar -->
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div class="relative w-full sm:max-w-xs">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="search"
            type="search"
            placeholder="Search by name or goal"
            aria-label="Search agents by name or goal"
            class="pl-9"
          />
        </div>
        <Select v-model="status">
          <SelectTrigger
            class="w-full sm:w-[180px]"
            aria-label="Filter agents by status"
          >
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in STATUS_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p
          class="text-sm text-muted-foreground sm:ml-auto"
          aria-live="polite"
        >
          {{ filtered.length }} of {{ agents.length }} agent{{ agents.length === 1 ? '' : 's' }}
        </p>
      </div>

      <!-- No-results-within-filter state -->
      <SectionCard
        v-if="noResults"
        class="border-dashed"
      >
        <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Search class="size-5" />
          </div>
          <div class="space-y-1">
            <p class="text-sm font-semibold">
              No agents match your filters
            </p>
            <p class="max-w-xs text-sm text-muted-foreground">
              Try a different search term or status.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            @click="clearFilters"
          >
            <X class="size-4" /> Clear filters
          </Button>
        </div>
      </SectionCard>

      <AgentTable
        v-else
        :agents="filtered"
      />
    </template>
  </div>
</template>
