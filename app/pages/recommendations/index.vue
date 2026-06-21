<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { AlertTriangle, ListChecks, RotateCw, X } from 'lucide-vue-next'
import type { RecommendationItem, Severity } from '#shared/types'
import SectionCard from '~/components/SectionCard.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Skeleton } from '~/components/ui/skeleton'
import { useTone } from '~/composables/useTone'
import { useBreadcrumb } from '~/composables/useBreadcrumb'

/**
 * /recommendations — the fleet-wide fix-queue.
 *
 * A single worklist of every open recommendation across all analyzed calls,
 * grouped by impact (high -> low) and, within a band, ordered by source-call
 * recency (the server already ranks this way). Each card deep-links back to the
 * source call/agent that raised it (W09) so the operator can surface a fix and
 * act on it in one hop. An optional ?agentId filter scopes the queue to one
 * agent (deep-linked from agent detail).
 */
const route = useRoute()
const router = useRouter()
const { getRecommendations } = useApi()
const { severityTone, severityLabel } = useTone()
const { setBreadcrumb } = useBreadcrumb()

useHead({ title: 'Recommendations — Voice AI Copilot' })

/** ?agentId scopes the queue to one agent; reactive so URL changes refetch. */
const agentId = computed(() => {
  const v = route.query.agentId
  return typeof v === 'string' && v ? v : undefined
})

const { data, pending, error, refresh } = await useAsyncData(
  'recommendations',
  () => getRecommendations(agentId.value ? { agentId: agentId.value } : undefined),
  { watch: [agentId] }
)

const items = computed<RecommendationItem[]>(() => data.value ?? [])

/** The scoped agent's name (any item carries it) for the filter chip + heading. */
const scopedAgentName = computed(() => (agentId.value ? items.value[0]?.agentName : undefined))

const isEmpty = computed(() => !pending.value && !error.value && items.value.length === 0)

/** Group into impact bands, highest first, preserving the server's intra-band order. */
const BANDS: Severity[] = ['high', 'medium', 'low']

const groups = computed(() =>
  BANDS
    .map(impact => ({
      impact,
      label: severityLabel(impact),
      items: items.value.filter(it => it.recommendation.impact === impact)
    }))
    .filter(g => g.items.length > 0)
)

const counts = computed(() => ({
  total: items.value.length,
  high: items.value.filter(i => i.recommendation.impact === 'high').length
}))

function clearAgentFilter() {
  router.push({ path: '/recommendations' })
}

watchEffect(() => {
  setBreadcrumb([{ label: 'Recommendations' }])
})

/** Stable key per item — same advice can recur across bands only via dedupe upstream. */
function itemKey(it: RecommendationItem): string {
  return `${it.recommendation.id}-${it.callId}`
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-4 md:p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight">
          Recommendations
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ scopedAgentName
            ? `Open fixes raised across ${scopedAgentName}'s analyzed calls.`
            : 'Every open fix across your fleet, ranked by impact. Each one links back to the call that raised it.' }}
        </p>
      </div>
      <div
        v-if="!pending && !error && items.length"
        class="flex items-center gap-2 text-sm text-muted-foreground tabular-nums"
      >
        <span>{{ counts.total }} open</span>
        <template v-if="counts.high">
          <span aria-hidden="true">·</span>
          <span :class="severityTone('high').text">{{ counts.high }} high impact</span>
        </template>
      </div>
    </div>

    <!-- Active agent filter chip -->
    <div
      v-if="agentId"
      class="flex flex-wrap items-center gap-2"
    >
      <span class="text-[12px] font-medium text-muted-foreground">Filtered to</span>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 py-1 pl-3 pr-2 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-primary"
        @click="clearAgentFilter"
      >
        <span class="truncate">{{ scopedAgentName ?? 'this agent' }}</span>
        <X class="size-3.5 text-muted-foreground" />
        <span class="sr-only">Clear agent filter</span>
      </button>
    </div>

    <!-- Loading -->
    <div
      v-if="pending"
      class="flex flex-col gap-6"
    >
      <div
        v-for="band in 2"
        :key="band"
        class="flex flex-col gap-3"
      >
        <Skeleton class="h-5 w-32 rounded-md" />
        <div class="grid gap-3 md:grid-cols-2">
          <Skeleton
            v-for="i in 2"
            :key="i"
            class="h-44 rounded-xl"
          />
        </div>
      </div>
    </div>

    <!-- Error -->
    <Alert
      v-else-if="error"
      variant="destructive"
    >
      <AlertTriangle />
      <AlertTitle>Couldn't load recommendations</AlertTitle>
      <AlertDescription class="flex flex-col items-start gap-3">
        <span>The fix-queue request failed{{ error?.statusCode ? ` (${error.statusCode})` : '' }}. Your connection may have dropped, or the analysis store is temporarily unavailable.</span>
        <Button
          variant="outline"
          size="sm"
          @click="refresh()"
        >
          <RotateCw class="size-4" /> Try again
        </Button>
      </AlertDescription>
    </Alert>

    <!-- Empty -->
    <SectionCard
      v-else-if="isEmpty"
      class="border-dashed"
    >
      <div class="flex flex-col items-center justify-center gap-4 py-14 text-center">
        <div class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ListChecks class="size-6" />
        </div>
        <div class="space-y-1">
          <h2 class="text-[18px] font-semibold">
            {{ agentId ? 'No open fixes for this agent' : 'No open recommendations' }}
          </h2>
          <p class="mx-auto max-w-sm text-sm text-muted-foreground">
            {{ agentId
              ? 'Every analyzed call for this agent is following its expected flow. Clear the filter to see the rest of the fleet, or review more calls.'
              : 'Analyze more calls to surface concrete prompt, script, and coaching fixes here. New recommendations appear ranked by impact.' }}
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <Button
            v-if="agentId"
            variant="outline"
            size="sm"
            @click="clearAgentFilter"
          >
            Clear filter
          </Button>
          <Button
            as-child
            size="sm"
          >
            <NuxtLink to="/calls">
              Review calls
            </NuxtLink>
          </Button>
        </div>
      </div>
    </SectionCard>

    <!-- Fix-queue, grouped by impact -->
    <template v-else>
      <section
        v-for="group in groups"
        :key="group.impact"
        class="flex flex-col gap-3"
        :aria-label="`${group.label} impact recommendations`"
      >
        <div class="flex items-center gap-2.5">
          <span
            :class="['flex size-2 rounded-full', severityTone(group.impact).dot]"
            aria-hidden="true"
          />
          <h2 class="text-[18px] font-semibold tracking-tight">
            {{ group.label }} impact
          </h2>
          <span class="rounded-full bg-muted px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted-foreground">
            {{ group.items.length }}
          </span>
        </div>

        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <RecommendationCard
            v-for="it in group.items"
            :key="itemKey(it)"
            :item="it"
          />
        </div>
      </section>
    </template>
  </div>
</template>
