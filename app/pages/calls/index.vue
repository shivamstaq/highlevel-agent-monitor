<script setup lang="ts">
import type { CallType, Severity } from '#shared/types'
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Phone,
  RotateCw,
  X
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import SectionCard from '~/components/SectionCard.vue'
import CallTable from '~/components/CallTable.vue'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/ui/select'
import { useApi } from '~/composables/useApi'
import { useBreadcrumb } from '~/composables/useBreadcrumb'

/**
 * /calls — the Calls inbox. The QA operator's daily triage queue.
 *
 * Renders GET /api/calls in the shared <CallTable> with URL-synced
 * agentId / severity / callType filters (deep-linkable from agent detail and
 * recommendation deep-links), pagination when long, plus loading / empty /
 * error states. Per the rebuilt contract, calls are filtered by callType
 * (LIVE|TRIAL — GHL trialCall), not the retired `outcome`/`direction`.
 */
const route = useRoute()
const router = useRouter()
const { getCalls, getFleet, syncCalls } = useApi()
const { setBreadcrumb } = useBreadcrumb()

setBreadcrumb([{ label: 'Calls' }])

/* ----------------------------------------------------------------------------
 * URL-synced filter state. Query params are the source of truth so every view
 * is deep-linkable (e.g. /calls?agentId=…&callType=LIVE).
 * ------------------------------------------------------------------------- */
const ALL = '__all__'

const agentId = computed(() => (typeof route.query.agentId === 'string' ? route.query.agentId : ''))
const severity = computed(() => (typeof route.query.severity === 'string' ? route.query.severity : ''))
const callType = computed(() => (typeof route.query.callType === 'string' ? route.query.callType : ''))

type QueryRecord = Record<string, string | undefined>

/** Rebuild the query keeping only truthy values, dropping `page` on filter change. */
function applyQuery(overrides: QueryRecord, dropPage = true) {
  const merged: QueryRecord = { ...(route.query as QueryRecord), ...overrides }
  if (dropPage) merged.page = undefined
  const next: QueryRecord = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v != null && v !== '') next[k] = v
  }
  router.replace({ query: next })
}

function setFilter(key: 'agentId' | 'severity' | 'callType', value: string) {
  applyQuery({ [key]: value === ALL ? undefined : value })
}

const hasFilters = computed(() => Boolean(agentId.value || severity.value || callType.value))

function clearFilters() {
  applyQuery({ agentId: undefined, severity: undefined, callType: undefined })
}

/** Drop just the agent scope, keeping any severity/callType filters (R3-09). */
function clearAgentFilter() {
  applyQuery({ agentId: undefined })
}

/* ----------------------------------------------------------------------------
 * Data. The list refetches whenever a filter changes (watched query keys).
 * Agent options come from the fleet rollup so the agent filter is a real
 * dropdown rather than a free-text field.
 * ------------------------------------------------------------------------- */
const { data: calls, pending, error, refresh } = await useAsyncData(
  'calls-inbox',
  () => getCalls({
    agentId: agentId.value || undefined,
    severity: (severity.value || undefined) as Severity | undefined,
    callType: (callType.value || undefined) as CallType | undefined
  }),
  { watch: [agentId, severity, callType] }
)

const { data: fleet } = await useAsyncData('calls-inbox-agents', () => getFleet())

const agentOptions = computed(() =>
  (fleet.value?.agents ?? [])
    .map(a => ({ id: a.agentId, name: a.agentName }))
    .sort((a, b) => a.name.localeCompare(b.name))
)

const severityOptions: { value: Severity, label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }
]

const callTypeOptions: { value: CallType, label: string }[] = [
  { value: 'LIVE', label: 'Live' },
  { value: 'TRIAL', label: 'Trial' }
]

const activeAgentName = computed(() =>
  agentOptions.value.find(a => a.id === agentId.value)?.name
)

/* ----------------------------------------------------------------------------
 * Pagination — keep the page snappy when a location has hundreds of calls.
 * ------------------------------------------------------------------------- */
const PAGE_SIZE = 25
const total = computed(() => calls.value?.length ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

const page = computed(() => {
  const raw = Number.parseInt(typeof route.query.page === 'string' ? route.query.page : '1', 10)
  if (Number.isNaN(raw) || raw < 1) return 1
  return Math.min(raw, pageCount.value)
})

function goToPage(p: number) {
  applyQuery({ page: p <= 1 ? undefined : String(p) }, false)
}

// If a filter change shrinks the result below the current page, snap back.
watch([total, pageCount], () => {
  if (page.value > pageCount.value) goToPage(pageCount.value)
})

const pagedCalls = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return (calls.value ?? []).slice(start, start + PAGE_SIZE)
})

const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1))
const rangeEnd = computed(() => Math.min(page.value * PAGE_SIZE, total.value))

/* ----------------------------------------------------------------------------
 * Sync from HighLevel — the inbox is home to this trigger.
 * ------------------------------------------------------------------------- */
const syncing = ref(false)
async function sync() {
  syncing.value = true
  try {
    const res = await syncCalls()
    if (res.ingested > 0) {
      toast.success('Calls synced', { description: `${res.ingested} new call${res.ingested === 1 ? '' : 's'} ingested from HighLevel.` })
    } else {
      toast.info('No new calls', { description: 'Your inbox is already up to date with HighLevel.' })
    }
    if (res.errors?.length) {
      toast.warning('Some calls were skipped', { description: res.errors[0] })
    }
    await refresh()
  } catch {
    toast.error('Couldn\'t sync calls', { description: 'HighLevel may not be connected. Check Settings, then try again.' })
  } finally {
    syncing.value = false
  }
}

const isEmpty = computed(() => !pending.value && !error.value && total.value === 0)

/** v-model bridges for the Selects (empty filter -> the explicit "all" sentinel). */
const agentModel = computed({
  get: () => agentId.value || ALL,
  set: v => setFilter('agentId', v)
})
const severityModel = computed({
  get: () => severity.value || ALL,
  set: v => setFilter('severity', v)
})
const callTypeModel = computed({
  get: () => callType.value || ALL,
  set: v => setFilter('callType', v)
})

// Keep the document title meaningful when scoped to one agent.
useHead({ title: computed(() => (activeAgentName.value ? `Calls · ${activeAgentName.value}` : 'Calls')) })
</script>

<template>
  <div class="flex w-full flex-col gap-5 px-3 py-3 md:px-4 md:py-4">
    <!-- Page header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">
          Calls
        </h1>
        <p class="text-sm text-muted-foreground">
          Every analyzed and synced call across your location. Filter to triage what needs attention.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="syncing"
        @click="sync"
      >
        <RotateCw :class="['size-4', syncing && 'motion-safe:animate-spin']" />
        {{ syncing ? 'Syncing…' : 'Sync calls from HighLevel' }}
      </Button>
    </div>

    <!-- Filters -->
    <SectionCard padding="dense">
      <div class="flex flex-wrap items-center gap-3">
        <span class="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <Filter class="size-3.5" />
          Filters
        </span>

        <Select v-model="agentModel">
          <SelectTrigger
            size="sm"
            class="w-[200px]"
            aria-label="Filter by agent"
          >
            <SelectValue placeholder="All agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">
              All agents
            </SelectItem>
            <SelectItem
              v-for="opt in agentOptions"
              :key="opt.id"
              :value="opt.id"
            >
              {{ opt.name }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="callTypeModel">
          <SelectTrigger
            size="sm"
            class="w-[150px]"
            aria-label="Filter by call type"
          >
            <SelectValue placeholder="Any type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">
              Any type
            </SelectItem>
            <SelectItem
              v-for="opt in callTypeOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select v-model="severityModel">
          <SelectTrigger
            size="sm"
            class="w-[160px]"
            aria-label="Filter by top severity"
          >
            <SelectValue placeholder="Any severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">
              Any severity
            </SelectItem>
            <SelectItem
              v-for="opt in severityOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Button
          v-if="hasFilters"
          variant="ghost"
          size="sm"
          class="ml-auto text-muted-foreground"
          @click="clearFilters"
        >
          <X class="size-3.5" />
          Clear filters
        </Button>
      </div>
    </SectionCard>

    <!-- Active agent scope chip (R3-09). The agent name links to its detail
         page; the X removes just the agent scope and keeps any other filters. -->
    <div
      v-if="agentId"
      class="flex flex-wrap items-center gap-2"
    >
      <span class="text-[12px] font-medium text-muted-foreground">Filtered to</span>
      <span class="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 py-1 pl-3 pr-1.5 text-[12px] font-medium">
        <NuxtLink
          :to="`/agents/${agentId}`"
          class="truncate rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {{ activeAgentName ?? 'this agent' }}
        </NuxtLink>
        <button
          type="button"
          class="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          @click="clearAgentFilter"
        >
          <X class="size-3.5" />
          <span class="sr-only">Remove agent filter</span>
        </button>
      </span>
    </div>

    <!-- Error -->
    <Alert
      v-if="error"
      variant="destructive"
    >
      <AlertTriangle />
      <AlertTitle>Couldn't load calls</AlertTitle>
      <AlertDescription>
        <p>The call list failed to load{{ error?.statusCode ? ` (error ${error.statusCode})` : '' }}. This is usually a temporary connection issue.</p>
        <Button
          variant="outline"
          size="sm"
          class="mt-2 w-fit"
          @click="() => refresh()"
        >
          <RotateCw class="size-4" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>

    <!-- Loading -->
    <Skeleton
      v-else-if="pending"
      class="h-[480px] rounded-xl"
    />

    <!-- Empty (no calls at all, no filters) -->
    <SectionCard
      v-else-if="isEmpty && !hasFilters"
      padding="roomy"
    >
      <div class="flex flex-col items-center gap-4 py-12 text-center">
        <div class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Phone class="size-6" />
        </div>
        <div class="space-y-1">
          <h2 class="text-[18px] font-semibold">
            No calls yet
          </h2>
          <p class="mx-auto max-w-sm text-sm text-muted-foreground">
            Sync your HighLevel Voice AI call logs to start triaging, or load demo data from Settings to explore the workflow.
          </p>
        </div>
        <Button
          :disabled="syncing"
          @click="sync"
        >
          <RotateCw :class="['size-4', syncing && 'motion-safe:animate-spin']" />
          {{ syncing ? 'Syncing…' : 'Sync calls from HighLevel' }}
        </Button>
      </div>
    </SectionCard>

    <!-- Results -->
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground tabular-nums">{{ total }}</span>
          {{ total === 1 ? 'call' : 'calls' }}
          <template v-if="hasFilters">
            match your filters<span v-if="activeAgentName"> for {{ activeAgentName }}</span>
          </template>
        </p>
        <p
          v-if="pageCount > 1"
          class="text-[12px] text-muted-foreground tabular-nums"
        >
          Showing {{ rangeStart }}–{{ rangeEnd }} of {{ total }}
        </p>
      </div>

      <CallTable
        :calls="pagedCalls"
        :show-agent="true"
        :empty-title="hasFilters ? 'No calls match these filters' : 'No calls to show'"
        :empty-hint="hasFilters ? 'Try widening or clearing your filters to see more calls.' : 'Sync calls from HighLevel to populate your inbox.'"
      />

      <!-- Pagination -->
      <nav
        v-if="pageCount > 1"
        class="flex items-center justify-between gap-2"
        aria-label="Calls pagination"
      >
        <Button
          variant="outline"
          size="sm"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          <ChevronLeft class="size-4" />
          Previous
        </Button>
        <span class="text-[12px] text-muted-foreground tabular-nums">
          Page {{ page }} of {{ pageCount }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="page >= pageCount"
          @click="goToPage(page + 1)"
        >
          Next
          <ChevronRight class="size-4" />
        </Button>
      </nav>
    </template>
  </div>
</template>
