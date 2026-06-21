<script setup lang="ts">
import type { FlowAlignment, FlowNodeKind, NodeStatus } from '#shared/types'
import { computed, watchEffect } from 'vue'
import { ArrowUpRight, CircleCheck, Info, Lightbulb, Target, Users } from 'lucide-vue-next'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Skeleton } from '~/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
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

useHead(() => ({ title: agent.value?.name ?? 'Agent' }))

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

/**
 * Criteria-met ring (P01). Plots the TRUE criteria-met rate — the share of
 * success criteria the agent's analyzed calls actually met (health.criteriaMetRate,
 * 0–1) — NOT the weighted Call score. `null` (no analyzed calls) renders an empty
 * ring with an em-dash so we never imply 0% met where nothing was measured.
 */
const hasCriteriaData = computed(() => (health.value?.criteriaMetRate ?? null) !== null)
const criteriaMetPct = computed(() =>
  hasCriteriaData.value ? Math.round((health.value!.criteriaMetRate as number) * 100) : 0
)

/**
 * Hand-rolled SSR-stable ring geometry (stroke-dasharray over a visible neutral
 * track) — the Unovis VisDonut rendered blank server-side and resolved its
 * remainder to an invisible near-white track (P01). r/circumference are fixed so
 * the teal arc subtends exactly criteriaMetPct/100 of the circle.
 */
const RING = { size: 160, stroke: 14 }
const ringRadius = (RING.size - RING.stroke) / 2
const ringCircumference = 2 * Math.PI * ringRadius
const ringDash = computed(() => (criteriaMetPct.value / 100) * ringCircumference)
const criteriaTone = computed(() =>
  hasCriteriaData.value ? toneClasses(scoreToneName(criteriaMetPct.value)).text : 'text-muted-foreground'
)

/**
 * Aggregate drift overlay for the Expected-call-flow diagram (P19): turn the
 * static design diagram into the agent's drift heatmap by feeding FlowDiagram a
 * synthetic FlowAlignment whose per-node status is the agent's WORST recurring
 * drift for that node (any skips -> skipped/warning, else any drift -> out_of_order,
 * else hit/success). driftScore carries the rate so the node tooltip reads true.
 */
const aggregateAlignment = computed<FlowAlignment | null>(() => {
  const fs = flowSummary.value
  if (!agent.value || !fs || fs.callsScored === 0) return null
  const nodeAlignments = fs.nodes.map((n) => {
    const status: NodeStatus = n.skipRate > 0 ? 'skipped' : 'out_of_order'
    const rate = n.skipRate > 0 ? n.skipRate : n.driftRate
    return {
      nodeId: n.nodeId,
      label: n.label,
      // Server guarantees a FlowNodeKind; the client FlowDriftSummary widens it to string.
      kind: n.kind as FlowNodeKind,
      status,
      driftScore: Math.min(1, Math.max(0, rate)),
      matchedTurnIdxs: [],
      note: `${Math.round(rate * 100)}% of scored calls ${n.skipRate > 0 ? 'skipped' : 'drifted on'} this step`
    }
  })
  return {
    callId: '',
    agentId: agent.value.id,
    conformanceScore: fs.avgConformance ?? 0,
    fitness: 0,
    nodeAlignments,
    actualPath: []
  }
})

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
                <span class="flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
                  Avg score
                  <TooltipProvider :delay-duration="120">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          class="rounded-full text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
                          aria-label="What is Avg score?"
                        >
                          <Info class="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent class="max-w-xs text-xs">
                        Avg score — this agent's average Call score (the overall weighted QA score of a call, 0–100) across its analyzed calls.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
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

          <!--
            Expected flow + actual drift, fused (P19): the per-node skip-rate list
            and the expected-flow diagram now live in ONE card so they read as a
            single expected-vs-actual story, and the diagram is tinted by each
            node's fleet drift rate (the agent's drift heatmap) instead of being a
            static design picture beside a disconnected bar list.
          -->
          <SectionCard
            v-if="flow || (flowSummary && flowSummary.callsScored > 0)"
            title="Expected call flow vs. actual drift"
            description="The agent's designed flow, painted with where its scored calls actually skip or drift."
            padding="roomy"
          >
            <template
              v-if="flowSummary && flowSummary.avgConformance !== null"
              #actions
            >
              <div class="text-right">
                <div class="flex items-center justify-end gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Flow adherence
                  <TooltipProvider :delay-duration="120">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          class="rounded-full text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
                          aria-label="What is Flow adherence?"
                        >
                          <Info class="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent class="max-w-xs text-xs">
                        Flow adherence — how closely this agent's calls followed their expected flow (0–100), averaged across {{ flowSummary.callsScored }} scored call{{ flowSummary.callsScored === 1 ? '' : 's' }}.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div :class="cn('text-2xl font-semibold tabular-nums', conformanceTone(flowSummary.avgConformance))">
                  {{ flowSummary.avgConformance }}
                </div>
              </div>
            </template>

            <div class="flex flex-col gap-5">
              <!-- Actual: where the agent's scored calls depart from the design. -->
              <div
                v-if="flowSummary && flowSummary.nodes.length"
                class="flex flex-col gap-4"
              >
                <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Most-skipped steps ({{ flowSummary.callsScored }} scored call{{ flowSummary.callsScored === 1 ? '' : 's' }})
                </p>
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
                v-else-if="flowSummary && flowSummary.callsScored > 0"
                class="text-sm text-muted-foreground"
              >
                No recurring drift — scored calls follow the expected flow.
              </p>

              <!-- Expected: the design diagram, tinted by each node's drift rate. -->
              <div
                v-if="flow"
                class="border-t pt-5"
              >
                <FlowDiagram
                  :flow="flow"
                  :alignment="aggregateAlignment"
                  :interactive="false"
                />
              </div>
            </div>
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

        <!-- Narrow column: Criteria-met ring + recommendations -->
        <div class="flex min-w-0 flex-col gap-6">
          <SectionCard
            title="Criteria met"
            description="Share of this agent's success criteria its scored calls actually met."
            padding="roomy"
          >
            <div class="flex flex-col items-center gap-4">
              <!--
                SSR-stable Criteria-met ring (P01): a stroke-dasharray SVG arc over
                a VISIBLE neutral track. Plots the true criteria-met rate
                (criteriaMetRate, share of perCriterion.met) — NOT the Call score.
                The teal arc subtends exactly criteriaMetPct/100 of the circle and
                renders identically server-side and after hydration.
              -->
              <div
                class="relative"
                :style="{ width: `${RING.size}px`, height: `${RING.size}px` }"
              >
                <svg
                  :viewBox="`0 0 ${RING.size} ${RING.size}`"
                  class="size-full -rotate-90"
                  role="img"
                  :aria-label="hasCriteriaData ? `${criteriaMetPct}% of success criteria met` : 'No criteria-met data yet'"
                >
                  <!-- Track: visible neutral ring (not the invisible near-white --muted). -->
                  <circle
                    :cx="RING.size / 2"
                    :cy="RING.size / 2"
                    :r="ringRadius"
                    fill="none"
                    stroke="var(--border)"
                    :stroke-width="RING.stroke"
                  />
                  <!-- Value arc: single teal accent series. -->
                  <circle
                    v-if="hasCriteriaData"
                    :cx="RING.size / 2"
                    :cy="RING.size / 2"
                    :r="ringRadius"
                    fill="none"
                    stroke="var(--primary)"
                    :stroke-width="RING.stroke"
                    stroke-linecap="round"
                    :stroke-dasharray="`${ringDash} ${ringCircumference}`"
                    class="motion-safe:transition-[stroke-dasharray] motion-safe:duration-[var(--dur)] motion-safe:ease-[var(--ease)]"
                  />
                </svg>
                <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span :class="cn('text-3xl font-semibold tabular-nums', criteriaTone)">
                    {{ hasCriteriaData ? `${criteriaMetPct}%` : '—' }}
                  </span>
                  <span class="text-[12px] text-muted-foreground">criteria met</span>
                </div>
              </div>

              <p
                v-if="!hasCriteriaData"
                class="text-center text-sm text-muted-foreground"
              >
                No analyzed calls yet — this ring fills once we score the agent's calls.
              </p>

              <!--
                Per-criterion list (P01): the criteria measured. A true per-criterion
                met % needs server per-criterion aggregates we don't carry here, so we
                show the criteria and their kind honestly rather than fabricate a rate.
              -->
              <div
                v-if="agent.successCriteria.length"
                class="w-full space-y-2.5"
              >
                <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Success criteria
                </p>
                <div
                  v-for="c in agent.successCriteria"
                  :key="c.id"
                  class="flex items-center justify-between gap-2 text-sm"
                >
                  <span class="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
                    <CircleCheck :class="cn('size-3.5 shrink-0', toneClasses('success').text)" />
                    <span class="truncate">{{ c.label }}</span>
                  </span>
                  <Badge
                    variant="outline"
                    class="shrink-0 rounded-md text-[11px] capitalize"
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
