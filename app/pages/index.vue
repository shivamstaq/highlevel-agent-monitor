<script setup lang="ts">
import { computed } from 'vue'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ListChecks,
  PhoneCall,
  PlusCircle,
  Sparkles,
  TrendingDown
} from 'lucide-vue-next'
import SectionCard from '~/components/SectionCard.vue'
import KpiCard from '~/components/KpiCard.vue'
import HealthChart from '~/components/HealthChart.vue'
import AgentTable from '~/components/AgentTable.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Skeleton } from '~/components/ui/skeleton'
import { useApi } from '~/composables/useApi'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { scoreToneName, type Tone } from '~/composables/useTone'

useHead({ title: 'Overview · Voice AI Copilot' })

// Overview is the root crumb; the layout renders "Overview" itself, so the
// page-supplied trail stays empty.
const { setBreadcrumb } = useBreadcrumb()
setBreadcrumb([])

const { getFleet } = useApi()

const { data: fleet, pending, error, refresh } = await useAsyncData('fleet', () => getFleet())

/** Bounded previews so the two columns terminate near the same baseline (W17). */
const AGENT_PREVIEW = 5
const REC_PREVIEW = 4

const sparkScores = computed(() => (fleet.value?.trend ?? []).map(t => t.score))
const isEmpty = computed(() => !pending.value && !error.value && (fleet.value?.agents?.length ?? 0) === 0)

const agentCount = computed(() => fleet.value?.agents?.length ?? 0)
const topAgents = computed(() => (fleet.value?.agents ?? []).slice(0, AGENT_PREVIEW))

const recCount = computed(() => fleet.value?.topRecommendations?.length ?? 0)
const topRecs = computed(() => (fleet.value?.topRecommendations ?? []).slice(0, REC_PREVIEW))

function fmtPct(n: number | undefined): string {
  return `${Math.round((n ?? 0) * 100)}%`
}

/** Fleet-health band drives the one accent/status tint on the KPI row. */
const healthTone = computed<Tone>(() => scoreToneName(fleet.value?.fleetHealth))
const healthDelta = computed(() => {
  const t = fleet.value?.trend ?? []
  if (t.length < 2) return 'No trend yet'
  const delta = Math.round((t.at(-1)!.score) - (t.at(-2)!.score))
  if (delta === 0) return 'Flat vs. yesterday'
  return `${delta > 0 ? '+' : ''}${delta} vs. yesterday`
})

/** Failure rate above 20% is a warning band; the KPI tints only then. */
const failureTone = computed<Tone>(() => ((fleet.value?.failureRate ?? 0) > 0.2 ? 'warning' : 'neutral'))
const failureDelta = computed(() =>
  (fleet.value?.failureRate ?? 0) > 0.2 ? 'Above 20% target' : 'Within target'
)

const useActionTone = computed<Tone>(() => ((fleet.value?.openUseActions ?? 0) > 0 ? 'warning' : 'neutral'))
const useActionDelta = computed(() =>
  (fleet.value?.openUseActions ?? 0) > 0 ? 'Awaiting review' : 'All clear'
)
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-4 md:p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-[24px] font-semibold leading-tight tracking-tight">
          Overview
        </h1>
        <p class="text-sm text-muted-foreground">
          Autonomous QA across every Voice AI agent in your location.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          as-child
          size="sm"
        >
          <NuxtLink to="/agents/new">
            <PlusCircle class="size-4" /> New agent
          </NuxtLink>
        </Button>
      </div>
    </div>

    <!-- Error -->
    <Alert
      v-if="error"
      variant="destructive"
    >
      <AlertTriangle class="size-4" />
      <AlertTitle>Couldn't load your fleet</AlertTitle>
      <AlertDescription class="flex flex-col items-start gap-3">
        <span>
          The dashboard data didn't come back{{ error?.statusCode ? ` (error ${error.statusCode})` : '' }}.
          This is usually a temporary connection issue.
        </span>
        <Button
          variant="outline"
          size="sm"
          @click="refresh()"
        >
          Try again
        </Button>
      </AlertDescription>
    </Alert>

    <!-- Loading -->
    <template v-else-if="pending">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          v-for="i in 4"
          :key="i"
          label=""
          :value="0"
          :icon="Activity"
          loading
        />
      </div>
      <Skeleton class="h-[244px] rounded-xl" />
      <div class="grid gap-6 lg:grid-cols-5">
        <Skeleton class="h-[360px] rounded-xl lg:col-span-3" />
        <Skeleton class="h-[360px] rounded-xl lg:col-span-2" />
      </div>
    </template>

    <!-- Empty state — invites loading demo data from Settings -->
    <SectionCard
      v-else-if="isEmpty"
      class="border-dashed"
    >
      <div class="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div class="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Activity class="size-7" />
        </div>
        <div class="space-y-1">
          <h2 class="text-[18px] font-semibold leading-tight">
            No agents yet
          </h2>
          <p class="mx-auto max-w-md text-sm text-muted-foreground">
            Connect a HighLevel location or load the demo dataset to see seeded agents,
            call transcripts, and analysis findings here.
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <Button as-child>
            <NuxtLink to="/settings">
              <Sparkles class="size-4" /> Load demo data
            </NuxtLink>
          </Button>
          <Button
            as-child
            variant="outline"
          >
            <NuxtLink to="/agents/new">
              <PlusCircle class="size-4" /> New agent
            </NuxtLink>
          </Button>
        </div>
      </div>
    </SectionCard>

    <!-- Dashboard -->
    <template v-else-if="fleet">
      <!-- 4 uniform KPI cards -->
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Fleet health"
          :value="Math.round(fleet.fleetHealth)"
          :icon="Activity"
          :tone="healthTone"
          :spark="sparkScores"
          :delta="healthDelta"
        />
        <KpiCard
          label="Calls analyzed"
          :value="fleet.callsAnalyzed"
          :icon="PhoneCall"
          :delta="`Across ${agentCount} agent${agentCount === 1 ? '' : 's'}`"
        />
        <KpiCard
          label="Failure rate"
          :value="fmtPct(fleet.failureRate)"
          :icon="TrendingDown"
          :tone="failureTone"
          :delta="failureDelta"
        />
        <KpiCard
          label="Open use actions"
          :value="fleet.openUseActions"
          :icon="ListChecks"
          :tone="useActionTone"
          :delta="useActionDelta"
        />
      </div>

      <!-- Compact trend strip -->
      <SectionCard
        title="Fleet health trend"
        description="Average call score per day"
        padding="dense"
      >
        <HealthChart
          :trend="fleet.trend"
          :height="180"
        />
      </SectionCard>

      <!-- Two-column work area: agents preview + recommendations preview -->
      <div class="grid items-start gap-6 lg:grid-cols-5">
        <!-- Agents preview (top-N) -->
        <section class="flex flex-col gap-3 lg:col-span-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-baseline gap-2">
              <h2 class="text-[18px] font-semibold leading-tight tracking-tight">
                Agents
              </h2>
              <span class="text-sm text-muted-foreground tabular-nums">
                {{ agentCount }} monitored
              </span>
            </div>
            <NuxtLink
              to="/agents"
              class="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              View all
              <ArrowRight class="size-3.5" />
            </NuxtLink>
          </div>

          <AgentTable :agents="topAgents" />

          <p
            v-if="agentCount > AGENT_PREVIEW"
            class="text-[12px] text-muted-foreground"
          >
            Showing top {{ AGENT_PREVIEW }} of {{ agentCount }} by score.
            <NuxtLink
              to="/agents"
              class="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              View all agents
            </NuxtLink>
          </p>
        </section>

        <!-- Recommendations preview (top-N, deep-linked) -->
        <section class="flex flex-col gap-3 lg:col-span-2">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-baseline gap-2">
              <h2 class="text-[18px] font-semibold leading-tight tracking-tight">
                Top recommendations
              </h2>
              <span
                v-if="recCount"
                class="text-sm text-muted-foreground tabular-nums"
              >
                {{ recCount }} open
              </span>
            </div>
            <NuxtLink
              v-if="recCount"
              to="/recommendations"
              class="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              View all
              <ArrowRight class="size-3.5" />
            </NuxtLink>
          </div>

          <div
            v-if="topRecs.length"
            class="flex flex-col gap-3"
          >
            <RecommendationCard
              v-for="item in topRecs"
              :key="item.recommendation.id"
              :item="item"
              compact
            />
            <NuxtLink
              v-if="recCount > REC_PREVIEW"
              to="/recommendations"
              class="inline-flex items-center gap-1 self-start rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              See all {{ recCount }} recommendations
              <ArrowRight class="size-3.5" />
            </NuxtLink>
          </div>

          <SectionCard v-else>
            <div class="flex flex-col items-center gap-3 py-8 text-center">
              <div class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <ListChecks class="size-5" />
              </div>
              <div class="space-y-1">
                <p class="text-sm font-semibold">
                  No open recommendations
                </p>
                <p class="mx-auto max-w-xs text-sm text-muted-foreground">
                  Every analyzed call is on track. Analyze more calls to surface
                  prompt and script improvements here.
                </p>
              </div>
              <Button
                as-child
                variant="outline"
                size="sm"
              >
                <NuxtLink to="/calls">
                  Go to calls
                </NuxtLink>
              </Button>
            </div>
          </SectionCard>
        </section>
      </div>
    </template>
  </div>
</template>
