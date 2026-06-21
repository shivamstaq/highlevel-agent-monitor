<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, ChevronRight, CircleCheck, Target } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Skeleton } from '~/components/ui/skeleton'
import { VisDonut, VisSingleContainer } from '@unovis/vue'
import SeverityBadge from '~/components/SeverityBadge.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import FlowDiagram from '~/components/FlowDiagram.vue'

const route = useRoute()
const id = computed(() => route.params.id as string)
const { getAgent, getAgentFlow } = useApi()

const { data, pending } = await useAsyncData(`agent-${id.value}`, () => getAgent(id.value))
const { data: flow } = await useAsyncData(`agent-flow-${id.value}`, () => getAgentFlow(id.value))

const agent = computed(() => data.value?.health.agent)
const health = computed(() => data.value?.health)
const flowSummary = computed(() => data.value?.flowSummary)

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const failingCalls = computed(() =>
  (data.value?.calls ?? [])
    .filter(c => c.topSeverity || (c.score !== null && c.score < 70))
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
)
const allCalls = computed(() => data.value?.calls ?? [])

const criteriaMet = computed(() => Math.round((health.value?.avgScore ?? 0)))
const donutData = computed(() => [criteriaMet.value, 100 - criteriaMet.value])

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
    <NuxtLink
      to="/"
      class="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft class="size-4" /> Back to overview
    </NuxtLink>

    <template v-if="pending">
      <Skeleton class="h-[140px] rounded-xl" />
      <div class="grid gap-6 lg:grid-cols-3">
        <Skeleton class="h-[300px] rounded-xl lg:col-span-2" />
        <Skeleton class="h-[300px] rounded-xl" />
      </div>
    </template>

    <template v-else-if="agent && health">
      <!-- Agent header -->
      <Card class="gap-0 py-0">
        <CardContent class="flex flex-col gap-5 p-5">
          <div class="flex flex-wrap items-start gap-4">
            <Avatar class="size-12 rounded-xl">
              <AvatarFallback class="rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                {{ initials(agent.name) }}
              </AvatarFallback>
            </Avatar>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <h1 class="text-xl font-semibold tracking-tight">
                {{ agent.name }}
              </h1>
              <p class="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Target class="mt-0.5 size-4 shrink-0" />
                {{ agent.goal }}
              </p>
            </div>
          </div>

          <div
            v-if="agent.successCriteria.length"
            class="flex flex-wrap gap-2"
          >
            <Badge
              v-for="c in agent.successCriteria"
              :key="c.id"
              variant="outline"
              class="gap-1.5 font-medium"
            >
              <CircleCheck class="size-3 text-emerald-500" />
              {{ c.label }}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Left column: stats + failing calls -->
        <div class="flex flex-col gap-6 lg:col-span-2">
          <!-- Stat strip -->
          <Card class="gap-0 py-0">
            <CardContent class="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <div class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">Avg score</span>
                <span class="text-2xl font-semibold tabular-nums">{{ Math.round(health.avgScore) }}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">Calls analyzed</span>
                <span class="text-2xl font-semibold tabular-nums">{{ health.callsAnalyzed }}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">Failure rate</span>
                <span
                  class="text-2xl font-semibold tabular-nums"
                  :class="health.failureRate > 0 ? 'text-red-600 dark:text-red-400' : ''"
                >
                  {{ Math.round(health.failureRate * 100) }}%
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">Open use-actions</span>
                <span class="text-2xl font-semibold tabular-nums">{{ health.openUseActions }}</span>
              </div>
            </CardContent>
          </Card>

          <!-- Flow drift across calls (the validation flywheel) -->
          <Card
            v-if="flowSummary && flowSummary.callsScored > 0"
            class="gap-0 py-0"
          >
            <CardHeader class="flex-row items-center justify-between border-b py-4">
              <div>
                <CardTitle class="text-base">
                  Flow drift across calls
                </CardTitle>
                <p class="text-xs text-muted-foreground">
                  Where this agent most often departs from its designed flow ({{ flowSummary.callsScored }} calls)
                </p>
              </div>
              <div
                v-if="flowSummary.avgConformance !== null"
                class="text-right"
              >
                <div class="text-[11px] text-muted-foreground">
                  Avg conformance
                </div>
                <div
                  class="text-xl font-semibold tabular-nums"
                  :class="flowSummary.avgConformance >= 80 ? 'text-emerald-600 dark:text-emerald-400' : flowSummary.avgConformance >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'"
                >
                  {{ flowSummary.avgConformance }}
                </div>
              </div>
            </CardHeader>
            <CardContent class="flex flex-col gap-3 p-5">
              <div
                v-for="n in flowSummary.nodes.slice(0, 5)"
                :key="n.nodeId"
                class="flex flex-col gap-1"
              >
                <div class="flex items-center justify-between gap-2 text-sm">
                  <span class="flex items-center gap-2 truncate">
                    <Badge
                      variant="outline"
                      class="text-[10px] capitalize"
                    >{{ n.kind }}</Badge>
                    <span class="truncate font-medium">{{ n.label }}</span>
                  </span>
                  <span class="shrink-0 tabular-nums text-muted-foreground">
                    {{ Math.round((n.skipRate > 0 ? n.skipRate : n.driftRate) * 100) }}% {{ n.skipRate > 0 ? 'skipped' : 'drifted' }}
                  </span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full"
                    :class="n.skipRate > 0 ? 'bg-red-500' : 'bg-amber-500'"
                    :style="{ width: `${Math.round((n.skipRate > 0 ? n.skipRate : n.driftRate) * 100)}%` }"
                  />
                </div>
              </div>
              <p
                v-if="!flowSummary.nodes.length"
                class="py-2 text-center text-sm text-muted-foreground"
              >
                No recurring drift — calls follow the designed flow.
              </p>
            </CardContent>
          </Card>

          <!-- Failing calls -->
          <Card class="gap-0 py-0">
            <CardHeader class="flex-row items-center justify-between border-b py-4">
              <CardTitle class="text-base">
                Calls needing attention
              </CardTitle>
              <span class="text-sm text-muted-foreground">{{ failingCalls.length }} of {{ allCalls.length }}</span>
            </CardHeader>
            <CardContent class="p-0">
              <div
                v-if="failingCalls.length"
                class="divide-y"
              >
                <NuxtLink
                  v-for="item in failingCalls"
                  :key="item.call.id"
                  :to="`/calls/${item.call.id}`"
                  class="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/40"
                >
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-medium">{{ item.call.contactName || 'Unknown contact' }}</span>
                      <Badge
                        variant="outline"
                        class="text-[10px] capitalize"
                      >{{ item.call.direction }}</Badge>
                    </div>
                    <span class="truncate text-xs text-muted-foreground">
                      {{ item.call.outcome || 'No outcome' }} · {{ fmtDate(item.call.startedAt) }} · {{ item.findingCount }} finding{{ item.findingCount === 1 ? '' : 's' }}
                    </span>
                  </div>
                  <SeverityBadge :severity="item.topSeverity" />
                  <span class="w-9 text-right text-sm font-semibold tabular-nums">
                    {{ item.score === null ? '—' : Math.round(item.score) }}
                  </span>
                  <ChevronRight class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </NuxtLink>
              </div>
              <div
                v-else
                class="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                No failing calls. This agent is performing within criteria.
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Right column: expected flow + criteria donut + recommendations -->
        <div class="flex flex-col gap-6">
          <Card
            v-if="flow"
            class="gap-0 py-0"
          >
            <CardHeader class="border-b py-4">
              <CardTitle class="text-base">
                Expected call flow
              </CardTitle>
              <p class="text-xs text-muted-foreground">
                Design intent generated from the agent's goal &amp; script
              </p>
            </CardHeader>
            <CardContent class="p-4">
              <FlowDiagram :flow="flow" />
            </CardContent>
          </Card>

          <Card class="gap-0 py-0">
            <CardHeader class="border-b py-4">
              <CardTitle class="text-base">
                Criteria met
              </CardTitle>
            </CardHeader>
            <CardContent class="flex flex-col items-center gap-3 p-5">
              <div class="relative h-[160px] w-[160px]">
                <VisSingleContainer
                  :data="donutData"
                  :height="160"
                >
                  <VisDonut
                    :value="(d: number) => d"
                    :arc-width="14"
                    :corner-radius="6"
                    :color="['var(--primary)', 'var(--muted)']"
                  />
                </VisSingleContainer>
                <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-3xl font-semibold tabular-nums">{{ criteriaMet }}%</span>
                  <span class="text-xs text-muted-foreground">avg met</span>
                </div>
              </div>
              <div class="w-full space-y-2.5">
                <div
                  v-for="c in agent.successCriteria"
                  :key="c.id"
                  class="flex items-center justify-between gap-2 text-sm"
                >
                  <span class="truncate text-muted-foreground">{{ c.label }}</span>
                  <Badge
                    variant="outline"
                    class="capitalize text-[10px]"
                  >
                    {{ c.kind }}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <div class="flex flex-col gap-3">
            <h2 class="text-base font-semibold">
              Recommendations
            </h2>
            <div
              v-if="data?.recommendations.length"
              class="flex flex-col gap-3"
            >
              <RecommendationCard
                v-for="rec in data.recommendations"
                :key="rec.id"
                :recommendation="rec"
              />
            </div>
            <Card
              v-else
              class="border-dashed"
            >
              <CardContent class="py-8 text-center text-sm text-muted-foreground">
                No recommendations for this agent yet.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </template>

    <Card
      v-else
      class="border-dashed"
    >
      <CardContent class="py-16 text-center text-sm text-muted-foreground">
        Agent not found.
      </CardContent>
    </Card>
  </div>
</template>
