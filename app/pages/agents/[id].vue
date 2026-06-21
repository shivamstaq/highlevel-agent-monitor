<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { ArrowUpRight, CircleCheck, Lightbulb, Target, Users } from 'lucide-vue-next'
import { VisDonut, VisSingleContainer } from '@unovis/vue'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Skeleton } from '~/components/ui/skeleton'
import SectionCard from '~/components/SectionCard.vue'
import CallTable from '~/components/CallTable.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import FlowDiagram from '~/components/FlowDiagram.vue'
import { useApi } from '~/composables/useApi'
import { useTone } from '~/composables/useTone'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { cn } from '~/lib/utils'

const route = useRoute()
const id = computed(() => route.params.id as string)
const { getAgent, getAgentFlow } = useApi()
const { scoreToneName, toneClasses } = useTone()
const { setBreadcrumb } = useBreadcrumb()

const { data, pending, error, refresh } = await useAsyncData(`agent-${id.value}`, () => getAgent(id.value))
// Flow is generated lazily and may fail independently; don't let it block the page.
const { data: flow } = await useAsyncData(`agent-flow-${id.value}`, () => getAgentFlow(id.value), {
  default: () => null
})

const agent = computed(() => data.value?.health.agent)
const health = computed(() => data.value?.health)
const flowSummary = computed(() => data.value?.flowSummary)
const recommendations = computed(() => data.value?.recommendations ?? [])

useHead(() => ({ title: `${agent.value?.name ?? 'Agent'} · Voice AI Copilot` }))

watchEffect(() => {
  setBreadcrumb([
    { label: 'Agents', to: '/agents' },
    { label: agent.value?.name ?? 'Agent' }
  ])
})

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

/** Calls below the bar or carrying a finding — the agent's triage queue. */
const failingCalls = computed(() =>
  (data.value?.calls ?? [])
    .filter(c => c.topSeverity || (c.score !== null && c.score < 70))
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
)
const allCalls = computed(() => data.value?.calls ?? [])

/* Headline avg-score donut: filled arc = accent, remainder = neutral track. */
const criteriaMet = computed(() => Math.round(health.value?.avgScore ?? 0))
const donutData = computed(() => [criteriaMet.value, Math.max(0, 100 - criteriaMet.value)])

const failureTone = computed(() =>
  (health.value?.failureRate ?? 0) > 0 ? toneClasses('danger').text : 'text-foreground'
)

/** Drift bar: skips read as warning, reordering/drift as danger — via tokens. */
function driftRate(n: { skipRate: number, driftRate: number }): number {
  return n.skipRate > 0 ? n.skipRate : n.driftRate
}
function driftToneSet(n: { skipRate: number, driftRate: number }) {
  return n.skipRate > 0 ? toneClasses('warning') : toneClasses('danger')
}
function conformanceTone(score: number): string {
  return toneClasses(scoreToneName(score)).text
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-4 md:p-6">
    <!-- Error (transport / server) — distinct from a true not-found. -->
    <Alert
      v-if="error"
      variant="destructive"
    >
      <AlertTitle>Couldn't load this agent</AlertTitle>
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
      <Skeleton class="h-[120px] rounded-xl" />
      <div class="grid gap-6 lg:grid-cols-3">
        <Skeleton class="h-[420px] rounded-xl lg:col-span-2" />
        <Skeleton class="h-[420px] rounded-xl" />
      </div>
    </template>

    <!-- Loaded -->
    <template v-else-if="agent && health">
      <!-- Agent header -->
      <SectionCard padding="roomy">
        <div class="flex flex-col gap-5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="flex min-w-0 items-start gap-4">
              <Avatar class="size-12 shrink-0 rounded-full">
                <AvatarFallback class="rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {{ initials(agent.name) }}
                </AvatarFallback>
              </Avatar>
              <div class="flex min-w-0 flex-col gap-1">
                <h1 class="text-2xl font-semibold leading-tight tracking-tight">
                  {{ agent.name }}
                </h1>
                <p class="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Target class="mt-0.5 size-4 shrink-0" />
                  {{ agent.goal }}
                </p>
              </div>
            </div>
            <Button
              as-child
              variant="outline"
              size="sm"
            >
              <NuxtLink :to="`/calls?agentId=${agent.id}`">
                View all calls
                <ArrowUpRight class="size-4" />
              </NuxtLink>
            </Button>
          </div>

          <div
            v-if="agent.successCriteria.length"
            class="flex flex-wrap gap-2"
          >
            <Badge
              v-for="c in agent.successCriteria"
              :key="c.id"
              variant="outline"
              class="gap-1.5 rounded-md font-medium"
            >
              <CircleCheck :class="cn('size-3', toneClasses('success').text)" />
              {{ c.label }}
            </Badge>
          </div>
        </div>
      </SectionCard>

      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Wide column: stats + drift + expected flow + failing calls -->
        <div class="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <!-- Stat strip -->
          <SectionCard padding="roomy">
            <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div class="flex flex-col gap-1">
                <span class="text-[12px] font-medium text-muted-foreground">Avg score</span>
                <span :class="cn('text-2xl font-semibold tabular-nums', toneClasses(scoreToneName(health.callsAnalyzed ? health.avgScore : null)).text)">
                  {{ health.callsAnalyzed ? Math.round(health.avgScore) : '—' }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[12px] font-medium text-muted-foreground">Calls analyzed</span>
                <span class="text-2xl font-semibold tabular-nums">{{ health.callsAnalyzed }}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[12px] font-medium text-muted-foreground">Failure rate</span>
                <span :class="cn('text-2xl font-semibold tabular-nums', failureTone)">
                  {{ Math.round(health.failureRate * 100) }}%
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[12px] font-medium text-muted-foreground">Open use actions</span>
                <span class="text-2xl font-semibold tabular-nums">{{ health.openUseActions }}</span>
              </div>
            </div>
          </SectionCard>

          <!-- Flow drift across calls -->
          <SectionCard
            v-if="flowSummary && flowSummary.callsScored > 0"
            title="Flow drift across calls"
            :description="`Where this agent most often departs from its expected flow (${flowSummary.callsScored} call${flowSummary.callsScored === 1 ? '' : 's'})`"
            padding="roomy"
          >
            <template
              v-if="flowSummary.avgConformance !== null"
              #actions
            >
              <div class="text-right">
                <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Avg adherence
                </div>
                <div :class="cn('text-2xl font-semibold tabular-nums', conformanceTone(flowSummary.avgConformance))">
                  {{ flowSummary.avgConformance }}
                </div>
              </div>
            </template>

            <div
              v-if="flowSummary.nodes.length"
              class="flex flex-col gap-4"
            >
              <div
                v-for="n in flowSummary.nodes.slice(0, 5)"
                :key="n.nodeId"
                class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5"
              >
                <span class="flex min-w-0 items-center gap-2 text-sm">
                  <Badge
                    variant="outline"
                    class="shrink-0 rounded-md text-[11px] capitalize"
                  >{{ n.kind }}</Badge>
                  <span class="truncate font-medium">{{ n.label }}</span>
                </span>
                <span class="shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {{ Math.round(driftRate(n) * 100) }}% {{ n.skipRate > 0 ? 'skipped' : 'drifted' }}
                </span>
                <div
                  class="col-span-2 h-2 overflow-hidden rounded-full"
                  :class="driftToneSet(n).bg"
                  role="progressbar"
                  :aria-valuenow="Math.round(driftRate(n) * 100)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="`${n.label} drift`"
                >
                  <div
                    class="h-full rounded-full"
                    :class="driftToneSet(n).dot"
                    :style="{ width: `${Math.max(2, Math.round(driftRate(n) * 100))}%` }"
                  />
                </div>
              </div>
            </div>
            <p
              v-else
              class="py-2 text-center text-sm text-muted-foreground"
            >
              No recurring drift — calls follow the expected flow.
            </p>
          </SectionCard>

          <!-- Expected call flow (moved to the wide column for room — W11) -->
          <SectionCard
            v-if="flow"
            title="Expected call flow"
            description="Design intent generated from the agent's goal and script."
            padding="roomy"
          >
            <FlowDiagram
              :flow="flow"
              :interactive="false"
            />
          </SectionCard>

          <!-- Calls needing attention -->
          <div class="flex flex-col gap-3">
            <div class="flex items-end justify-between gap-3">
              <h2 class="text-[18px] font-semibold tracking-tight">
                Calls needing attention
              </h2>
              <span class="text-sm text-muted-foreground">
                {{ failingCalls.length }} of {{ allCalls.length }}
              </span>
            </div>
            <CallTable
              :calls="failingCalls"
              :show-agent="false"
              :dense="true"
              empty-title="No calls need attention"
              empty-hint="Every analyzed call for this agent is within criteria."
            />
            <NuxtLink
              v-if="allCalls.length"
              :to="`/calls?agentId=${agent.id}`"
              class="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              View all calls for this agent
              <ArrowUpRight class="size-4" />
            </NuxtLink>
          </div>
        </div>

        <!-- Narrow column: adherence donut + recommendations -->
        <div class="flex min-w-0 flex-col gap-6">
          <SectionCard
            title="Avg criteria met"
            padding="roomy"
          >
            <div class="flex flex-col items-center gap-4">
              <div class="relative size-[160px]">
                <VisSingleContainer
                  :data="donutData"
                  :height="160"
                >
                  <VisDonut
                    :value="(d: number) => d"
                    :arc-width="14"
                    :corner-radius="6"
                    :color="['var(--primary)', 'var(--chart-track, var(--muted))']"
                  />
                </VisSingleContainer>
                <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-3xl font-semibold tabular-nums">{{ criteriaMet }}%</span>
                  <span class="text-[12px] text-muted-foreground">avg met</span>
                </div>
              </div>
              <div
                v-if="agent.successCriteria.length"
                class="w-full space-y-2.5"
              >
                <div
                  v-for="c in agent.successCriteria"
                  :key="c.id"
                  class="flex items-center justify-between gap-2 text-sm"
                >
                  <span class="truncate text-muted-foreground">{{ c.label }}</span>
                  <Badge
                    variant="outline"
                    class="rounded-md text-[11px] capitalize"
                  >
                    {{ c.kind }}
                  </Badge>
                </div>
              </div>
            </div>
          </SectionCard>

          <div class="flex flex-col gap-3">
            <h2 class="text-[18px] font-semibold tracking-tight">
              Recommendations
            </h2>
            <div
              v-if="recommendations.length"
              class="flex flex-col gap-3"
            >
              <RecommendationCard
                v-for="rec in recommendations"
                :key="rec.recommendation.id"
                :item="rec"
              />
            </div>
            <SectionCard
              v-else
              class="border-dashed"
            >
              <div class="flex flex-col items-center gap-3 py-8 text-center">
                <div class="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Lightbulb class="size-5" />
                </div>
                <div class="space-y-1">
                  <p class="text-sm font-semibold">
                    No recommendations yet
                  </p>
                  <p class="max-w-xs text-sm text-muted-foreground">
                    Analyze more of this agent's calls to surface concrete fixes for its prompt, script, or coaching.
                  </p>
                </div>
                <Button
                  as-child
                  variant="outline"
                  size="sm"
                >
                  <NuxtLink :to="`/calls?agentId=${agent.id}`">
                    View all calls
                  </NuxtLink>
                </Button>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </template>

    <!-- Not found (data resolved, no entity) — centered block. -->
    <div
      v-else
      class="flex justify-center"
    >
      <SectionCard class="w-full max-w-md border-dashed">
        <div class="flex flex-col items-center gap-3 py-12 text-center">
          <div class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users class="size-6" />
          </div>
          <div class="space-y-1">
            <p class="text-base font-semibold">
              Agent not found
            </p>
            <p class="max-w-xs text-sm text-muted-foreground">
              This agent may have been removed, or the link is out of date.
            </p>
          </div>
          <Button
            as-child
            variant="outline"
            size="sm"
          >
            <NuxtLink to="/agents">
              Back to agents
            </NuxtLink>
          </Button>
        </div>
      </SectionCard>
    </div>
  </div>
</template>
