<script setup lang="ts">
import { computed, ref } from 'vue'
import { Activity, ListChecks, PhoneCall, TrendingUp, Sparkles, PlusCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import KpiCard from '~/components/KpiCard.vue'
import HealthChart from '~/components/HealthChart.vue'
import AgentTable from '~/components/AgentTable.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'

const { getFleet, seed } = useApi()

const { data: fleet, pending, refresh } = await useAsyncData('fleet', () => getFleet())

const seeding = ref(false)
async function loadDemo() {
  seeding.value = true
  try {
    const res = await seed()
    toast.success('Demo data loaded', { description: `${res.agents} agents, ${res.calls} calls ingested.` })
    await refresh()
  } catch {
    toast.error('Could not load demo data')
  } finally {
    seeding.value = false
  }
}

const sparkScores = computed(() => (fleet.value?.trend ?? []).map(t => t.score))
const isEmpty = computed(() => !pending.value && (fleet.value?.agents?.length ?? 0) === 0)

function fmtPct(n: number | undefined): string {
  return `${Math.round((n ?? 0) * 100)}%`
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">
          Fleet Overview
        </h1>
        <p class="text-sm text-muted-foreground">
          Autonomous QA across every Voice AI agent in your location.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="!isEmpty"
          variant="outline"
          size="sm"
          :disabled="seeding"
          @click="loadDemo"
        >
          <Sparkles class="size-4" />
          {{ seeding ? 'Loading…' : 'Reload demo data' }}
        </Button>
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

    <!-- Loading -->
    <template v-if="pending">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton
          v-for="i in 4"
          :key="i"
          class="h-[120px] rounded-xl"
        />
      </div>
      <Skeleton class="h-[320px] rounded-xl" />
      <Skeleton class="h-[280px] rounded-xl" />
    </template>

    <!-- Empty state -->
    <Card
      v-else-if="isEmpty"
      class="border-dashed"
    >
      <CardContent class="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div class="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Activity class="size-7" />
        </div>
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">
            No agents yet
          </h2>
          <p class="mx-auto max-w-sm text-sm text-muted-foreground">
            Load the demo dataset to see seeded Voice AI agents, call transcripts, and analysis findings in action.
          </p>
        </div>
        <Button
          :disabled="seeding"
          @click="loadDemo"
        >
          <Sparkles class="size-4" />
          {{ seeding ? 'Loading…' : 'Load demo data' }}
        </Button>
      </CardContent>
    </Card>

    <!-- Dashboard -->
    <template v-else-if="fleet">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Fleet Health"
          :value="Math.round(fleet.fleetHealth)"
          :icon="Activity"
          accent="text-emerald-600 dark:text-emerald-400"
          :spark="sparkScores"
          trend="up"
        />
        <KpiCard
          label="Calls Analyzed"
          :value="fleet.callsAnalyzed"
          :icon="PhoneCall"
          accent="text-sky-600 dark:text-sky-400"
        />
        <KpiCard
          label="Failure Rate"
          :value="fmtPct(fleet.failureRate)"
          :icon="TrendingUp"
          accent="text-red-600 dark:text-red-400"
          invert
          :trend="fleet.failureRate > 0.2 ? 'up' : 'down'"
          :delta="fleet.failureRate > 0.2 ? 'Above target' : 'Within target'"
        />
        <KpiCard
          label="Open Use-Actions"
          :value="fleet.openUseActions"
          :icon="ListChecks"
          accent="text-amber-600 dark:text-amber-400"
        />
      </div>

      <Card class="gap-0 py-0">
        <CardHeader class="flex-row items-center justify-between border-b py-4">
          <div>
            <CardTitle class="text-base">
              Fleet health trend
            </CardTitle>
            <p class="text-sm text-muted-foreground">
              Average call score per day
            </p>
          </div>
        </CardHeader>
        <CardContent class="p-4">
          <HealthChart :trend="fleet.trend" />
        </CardContent>
      </Card>

      <div class="grid gap-6 lg:grid-cols-5">
        <div class="flex flex-col gap-3 lg:col-span-3">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">
              Agents
            </h2>
            <span class="text-sm text-muted-foreground">{{ fleet.agents.length }} monitored</span>
          </div>
          <AgentTable :agents="fleet.agents" />
        </div>

        <div class="flex flex-col gap-3 lg:col-span-2">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">
              Top recommendations
            </h2>
          </div>
          <div
            v-if="fleet.topRecommendations.length"
            class="flex flex-col gap-3"
          >
            <RecommendationCard
              v-for="rec in fleet.topRecommendations"
              :key="rec.id"
              :recommendation="rec"
            />
          </div>
          <Card
            v-else
            class="border-dashed"
          >
            <CardContent class="py-10 text-center text-sm text-muted-foreground">
              No recommendations yet. Analyze calls to surface improvements.
            </CardContent>
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>
