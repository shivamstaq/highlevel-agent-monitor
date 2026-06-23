<script setup lang="ts">
// CREATED — the agent overview: how the agent is DESIGNED to run, how it scores
// across calls, and a link out to each call's drift analysis.
/**
 * /agents/:id — a single, tab-free agent overview:
 *
 *   • Header — identity + aggregate health (avg score / calls / failure / flow).
 *   • Intended call flow — the agent's LLM-inferred happy-path flow (atomic
 *     steps + the purpose/rules of each). NO per-call drift here; drift lives on
 *     the call page. Clicking a step shows what it should accomplish.
 *   • Overall analysis — aggregate per-criterion scorecard + recurring fixes.
 *   • Call logs — a dense table; each row links to that call's drift analysis.
 *
 * The borrowed GHL Call-Flow / Build / Deploy surfaces were removed — they already
 * exist on the HighLevel platform and added no eval value here.
 */
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { ArrowUpRight, Inbox, Lightbulb, Loader2, Route, Target } from 'lucide-vue-next'
import type { CallListItem } from '#shared/types'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Skeleton } from '~/components/ui/skeleton'
import SectionCard from '~/components/SectionCard.vue'
import CallTable from '~/components/CallTable.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import IntendedFlowGraph from '~/components/IntendedFlowGraph.vue'
import FlowNodeDetail from '~/components/FlowNodeDetail.vue'
import { useApi } from '~/composables/useApi'
import { useTone } from '~/composables/useTone'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { cn } from '~/lib/utils'

const route = useRoute()
const id = computed(() => route.params.id as string)
const { getAgentDetail, inferAgentFlow } = useApi()
const { scoreToneName, scoreTone, toneClasses } = useTone()
const { setBreadcrumb } = useBreadcrumb()

const { data: detail, pending, error, refresh } = await useAsyncData(
  () => `agent-${id.value}`,
  () => getAgentDetail(id.value),
  { watch: [id] }
)

const agent = computed(() => detail.value?.agent ?? null)
const health = computed(() => detail.value?.health)
const calls = computed<CallListItem[]>(() => detail.value?.calls ?? [])
const recommendations = computed(() => detail.value?.recommendations ?? [])
const inferredFlow = computed(() => detail.value?.inferredFlow ?? null)
const criteriaScorecard = computed(() => detail.value?.criteriaScorecard ?? [])
const hasFlow = computed(() => Boolean(inferredFlow.value?.nodes.length))

const agentName = computed(() => health.value?.agentName ?? 'Agent')

useHead(() => ({ title: agentName.value }))
watchEffect(() => {
  setBreadcrumb([
    { label: 'Agents', to: '/agents' },
    { label: agentName.value }
  ])
})

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

/** Selected node / edge in the intended-flow graph (drives the step-detail panel). */
const selectedNodeId = ref<string | null>(null)
const selectedEdge = ref<{ condition: string, from: string, to: string } | null>(null)
function onSelectNode(nodeId: string) {
  selectedNodeId.value = selectedNodeId.value === nodeId ? null : nodeId
  selectedEdge.value = null
}
function onSelectEdge(payload: { condition: string, from: string, to: string }) {
  selectedEdge.value = payload
  selectedNodeId.value = null
}

const failureTone = computed(() =>
  (health.value?.failureRate ?? 0) > 0 ? toneClasses('danger').text : 'text-foreground'
)

/* ----------------------------------------------------------------------------
 * Intended call flow is derived from the agent's PROMPT — it needs no calls. So
 * we map it automatically as soon as the agent loads without one, and also expose
 * a manual trigger (idempotent; cached per-agent after the first derive).
 * ------------------------------------------------------------------------- */
const mappingFlow = ref(false)
const mapError = ref<string | null>(null)
async function mapFlow() {
  if (mappingFlow.value) return
  mappingFlow.value = true
  mapError.value = null
  try {
    await inferAgentFlow(id.value)
    await refresh()
  } catch (err: unknown) {
    mapError.value = (err as { statusMessage?: string, message?: string })?.statusMessage
      ?? (err as { message?: string })?.message
      ?? 'Could not map the intended flow.'
  } finally {
    mappingFlow.value = false
  }
}
/** Auto-map once when the agent has loaded but has no intended flow yet. */
function maybeAutoMap() {
  if (detail.value && !hasFlow.value && !mappingFlow.value && !mapError.value) void mapFlow()
}
onMounted(maybeAutoMap)
watch([detail, hasFlow], maybeAutoMap)
</script>

<template>
  <div class="flex w-full flex-col gap-5 px-3 py-3 md:px-4 md:py-4">
    <!-- Error -->
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
      <Skeleton class="h-[520px] rounded-xl" />
    </template>

    <!-- Loaded -->
    <template v-else-if="health">
      <!-- ============ HEADER: identity + aggregate health ============ -->
      <SectionCard padding="roomy">
        <div class="flex flex-col gap-5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="flex min-w-0 items-start gap-4">
              <Avatar class="size-12 shrink-0 rounded-full">
                <AvatarFallback class="rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {{ initials(agentName) }}
                </AvatarFallback>
              </Avatar>
              <div class="flex min-w-0 flex-col gap-1">
                <h1 class="text-2xl font-semibold leading-tight tracking-tight">
                  {{ agentName }}
                </h1>
                <p
                  v-if="agent?.ghl.businessName"
                  class="flex items-start gap-1.5 text-sm text-muted-foreground"
                >
                  <Target class="mt-0.5 size-4 shrink-0" />
                  {{ agent.ghl.businessName }}<template v-if="agent.ghl.agentType"> · {{ agent.ghl.agentType }}</template>
                </p>
              </div>
            </div>
            <Button
              as-child
              variant="outline"
              size="sm"
            >
              <NuxtLink :to="`/calls?agentId=${id}`">
                View all calls
                <ArrowUpRight class="size-4" />
              </NuxtLink>
            </Button>
          </div>

          <!-- Stat strip (aggregate health — no per-criterion artifact tags) -->
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
              <span class="text-[12px] font-medium text-muted-foreground">Flow adherence</span>
              <span
                v-if="health.avgFlowAdherence != null"
                :class="cn('text-2xl font-semibold tabular-nums', toneClasses(scoreToneName(health.avgFlowAdherence)).text)"
              >{{ Math.round(health.avgFlowAdherence) }}</span>
              <span
                v-else
                class="text-2xl font-semibold tabular-nums text-muted-foreground"
              >—</span>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- ============ INTENDED CALL FLOW (happy path — no drift) ============ -->
      <SectionCard padding="dense">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Route class="size-4" />
            </span>
            <div>
              <h2 class="text-[15px] font-semibold leading-tight">
                Intended call flow
              </h2>
              <p class="text-[12px] text-muted-foreground">
                How {{ agentName }} is designed to handle a call — the purpose of each step.
              </p>
            </div>
          </div>
          <span
            v-if="hasFlow"
            class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
          >
            Inferred from instructions
          </span>
        </div>

        <div
          v-if="hasFlow && inferredFlow"
          class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
        >
          <IntendedFlowGraph
            :flow="inferredFlow"
            :selected-node-id="selectedNodeId"
            height-class="h-[440px] lg:h-[600px]"
            @select="onSelectNode"
            @select-edge="onSelectEdge"
          />
          <FlowNodeDetail
            class="lg:sticky lg:top-[4.5rem] lg:max-h-[600px] lg:overflow-y-auto"
            :flow="inferredFlow"
            :selected-node-id="selectedNodeId"
            :selected-edge="selectedEdge"
          />
        </div>
        <!-- Mapping in progress (auto-triggered on load, or via the button). -->
        <div
          v-else-if="mappingFlow"
          class="flex flex-col items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] py-10 text-center"
        >
          <Loader2 class="size-5 animate-spin text-primary" />
          <p class="text-sm font-semibold">
            Mapping the intended call flow…
          </p>
          <p class="max-w-xs text-sm text-muted-foreground">
            Compiling {{ agentName }}'s instructions into its intended call-handling flow.
          </p>
        </div>
        <!-- Not mapped yet (auto-map errored or hasn't run) — manual trigger. -->
        <div
          v-else
          class="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center"
        >
          <span class="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Route class="size-4" />
          </span>
          <p class="text-sm font-semibold">
            {{ mapError ? 'Couldn\'t map the flow' : 'No flow mapped yet' }}
          </p>
          <p class="max-w-xs text-sm text-muted-foreground">
            {{ mapError ?? 'Map this agent\'s intended call flow from its instructions — no calls needed.' }}
          </p>
          <Button
            size="sm"
            class="mt-1"
            @click="mapFlow"
          >
            <Route class="size-4" />
            Map intended flow
          </Button>
        </div>
      </SectionCard>

      <!-- ============ OVERALL ANALYSIS: scorecard + recurring fixes ============ -->
      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <!-- Aggregate per-criterion scorecard -->
        <SectionCard
          title="Scorecard"
          :description="health.callsAnalyzed ? `Average per criterion across ${health.callsAnalyzed} analyzed call${health.callsAnalyzed === 1 ? '' : 's'}.` : undefined"
          padding="dense"
        >
          <div
            v-if="criteriaScorecard.length"
            class="flex flex-col gap-3"
          >
            <div
              v-for="c in criteriaScorecard"
              :key="c.criterionId"
              class="space-y-1.5"
            >
              <div class="flex items-center justify-between gap-2 text-[13px]">
                <span class="truncate font-medium">{{ c.label }}</span>
                <span :class="cn('shrink-0 font-semibold tabular-nums', scoreTone(c.avgScore))">
                  {{ c.avgScore != null ? c.avgScore : '—' }}
                </span>
              </div>
              <div :class="cn('h-1.5 overflow-hidden rounded-full', toneClasses(scoreToneName(c.avgScore)).bg)">
                <div
                  :class="cn('h-full rounded-full', toneClasses(scoreToneName(c.avgScore)).dot)"
                  :style="{ width: `${Math.max(2, c.avgScore ?? 0)}%` }"
                />
              </div>
              <p
                v-if="c.metRate != null"
                class="text-[11px] text-muted-foreground"
              >
                {{ Math.round(c.metRate * 100) }}% met · {{ c.callsScored }} call{{ c.callsScored === 1 ? '' : 's' }}
              </p>
            </div>
          </div>
          <p
            v-else
            class="py-6 text-center text-sm text-muted-foreground"
          >
            No analyzed calls yet — scores appear once calls are evaluated.
          </p>
        </SectionCard>

        <!-- Recurring fixes (deduped recommendations across this agent's calls) -->
        <SectionCard
          title="Recurring fixes"
          :description="recommendations.length ? 'The most common improvements across this agent’s calls.' : undefined"
          padding="dense"
        >
          <div
            v-if="recommendations.length"
            class="flex flex-col gap-2.5"
          >
            <RecommendationCard
              v-for="rec in recommendations"
              :key="rec.recommendation.id"
              :item="rec"
            />
          </div>
          <div
            v-else
            class="flex flex-col items-center gap-1.5 py-6 text-center"
          >
            <span class="flex size-9 items-center justify-center rounded-full bg-success-soft text-success">
              <Lightbulb class="size-4" />
            </span>
            <p class="text-sm font-semibold">
              Nothing to fix
            </p>
            <p class="max-w-xs text-sm text-muted-foreground">
              No recurring recommendations across this agent's analyzed calls.
            </p>
          </div>
        </SectionCard>
      </div>

      <!-- ============ CALL LOGS (each row links to its drift analysis) ============ -->
      <div class="flex flex-col gap-3">
        <div class="flex items-end justify-between gap-3">
          <h2 class="text-[18px] font-semibold tracking-tight">
            Call logs
          </h2>
          <span class="text-sm text-muted-foreground">{{ calls.length }} synced</span>
        </div>
        <CallTable
          :calls="calls"
          :show-agent="false"
          :dense="true"
          empty-title="No calls synced"
          empty-hint="Sync calls from HighLevel to populate this agent's call list."
        />
      </div>
    </template>

    <!-- Agent not found / empty -->
    <div
      v-else
      class="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center"
    >
      <div class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox class="size-6" />
      </div>
      <p class="text-sm text-muted-foreground">
        This agent couldn't be found.
      </p>
    </div>
  </div>
</template>
