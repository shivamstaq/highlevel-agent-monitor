<script setup lang="ts">
import type { Finding } from '#shared/types'
import { computed, onMounted, ref, watchEffect } from 'vue'
import {
  AlertTriangle,
  ArrowUpRight,
  Clock,
  FlaskConical,
  Inbox,
  ListChecks,
  Phone,
  Radio,
  RefreshCw,
  RotateCw,
  Route,
  Sparkles
} from 'lucide-vue-next'
import SectionCard from '~/components/SectionCard.vue'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Skeleton } from '~/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import TranscriptViewer from '~/components/TranscriptViewer.vue'
import FindingCard from '~/components/FindingCard.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import UseActionList from '~/components/UseActionList.vue'
import IntendedFlowGraph from '~/components/IntendedFlowGraph.vue'
import FlowNodeDetail from '~/components/FlowNodeDetail.vue'
import AnalysisProgress from '~/components/AnalysisProgress.vue'
import { isFallbackAnalysis, useApi } from '~/composables/useApi'
import { useAnalysis } from '~/composables/useAnalysis'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { useTone } from '~/composables/useTone'
import { relativeTime } from '~/lib/format'
import { cn } from '~/lib/utils'

/**
 * /calls/:id — call drill-down (CallDetail), R3 redesign. The PRIMARY surface is
 * the checkpoint drift view (expected-vs-actual per self-identified conversational
 * checkpoint); findings/recommendations/use-actions are the compact secondary
 * layer; the transcript is a compact CRM-dense artifact in a side rail. Analysis
 * is reactive — a live step-by-step progress feed runs while the pipeline works,
 * and the same call can't be analyzed twice at once (server single-flight).
 */
const route = useRoute()
const id = computed(() => route.params.id as string)
const { getCall } = useApi()
const { setBreadcrumb } = useBreadcrumb()
const { scoreTone, scoreToneSet, scoreToneName, toneClasses } = useTone()

const { data, pending, error, refresh } = await useAsyncData(`call-${id.value}`, () => getCall(id.value))

const call = computed(() => data.value?.call)
const agent = computed(() => data.value?.agent)
const analysis = computed(() => data.value?.analysis)
const transcript = computed(() => data.value?.transcript)
const inferredFlow = computed(() => data.value?.inferredFlow ?? null)
const flowAlignment = computed(() => analysis.value?.flowAlignment ?? null)
const hasFlow = computed(() => Boolean(inferredFlow.value?.nodes.length))

const analysisIsFallback = computed(() => isFallbackAnalysis(analysis.value))

/** A 404 = the fetch resolved but the entity is missing (vs a transport error). */
const notFound = computed(() => !pending.value && !error.value && !data.value?.call)

/** Calls have no contact name; identify by agent + time + type. */
const callTitle = computed(() => {
  if (!call.value) return 'Call'
  const when = relativeTime(call.value.createdAt)
  return `${agent.value?.ghl.agentName ?? 'Call'} · ${when}`
})

useHead({ title: computed(() => (call.value ? `${callTitle.value} · Call` : 'Call')) })
watchEffect(() => {
  setBreadcrumb([
    { label: 'Calls', to: '/calls' },
    { label: call.value ? callTitle.value : 'Call' }
  ])
})

/* ----------------------------------------------------------------------------
 * Reactive analysis run (trigger + live progress + single-flight).
 * ------------------------------------------------------------------------- */
const { running, triggering, steps, errorMessage, start, syncInitial } = useAnalysis(id, {
  onComplete: () => refresh()
})
onMounted(syncInitial)

const hasAnalysis = computed(() => Boolean(analysis.value))
const analyzeBusy = computed(() => running.value || triggering.value)
const analyzeLabel = computed(() =>
  analyzeBusy.value ? 'Analyzing…' : hasAnalysis.value ? 'Re-run analysis' : 'Analyze call'
)

/* ----------------------------------------------------------------------------
 * Cross-highlight between checkpoints / findings / use-actions and the transcript.
 * Indices are transcript ENTRY idxs.
 * ------------------------------------------------------------------------- */
const flashIdxs = ref<number[]>([])
const activeTurnIdxs = ref<number[]>([])
const activeFindingId = ref<string | null>(null)
const activeTab = ref('findings')

const evidenceIdxs = computed(() => {
  const set = new Set<number>()
  for (const f of analysis.value?.findings ?? []) {
    for (const i of f.evidenceEntryIdxs) set.add(i)
  }
  return [...set]
})

function selectTurns(entryIdxs: number[]) {
  if (entryIdxs.length) {
    activeTurnIdxs.value = [...entryIdxs]
    flashIdxs.value = [...entryIdxs]
  }
}
function selectFinding(f: Finding) {
  activeFindingId.value = f.id
  selectTurns(f.evidenceEntryIdxs)
}
function focusRange(range: [number, number]) {
  const [a, b] = range
  const out: number[] = []
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
  activeFindingId.value = null
  selectTurns(out)
}
function onSelectTurn(entryIdx: number) {
  activeFindingId.value = null
  selectTurns([entryIdx])
}
function onSelectFlowEvidence(entryIdxs: number[]) {
  activeFindingId.value = null
  selectTurns(entryIdxs)
}

/** Selected flow node / tangent (synced between the graph and the detail panel). */
const selectedNodeId = ref<string | null>(null)
const selectedEdge = ref<{ condition: string, from: string, to: string } | null>(null)
function onSelectNode(nodeId: string) {
  selectedNodeId.value = nodeId
  selectedEdge.value = null
  activeFindingId.value = null
  const a = flowAlignment.value?.nodeAlignments.find(x => x.nodeId === nodeId)
  const t = flowAlignment.value?.tangents.find(x => x.id === nodeId)
  const ev = a?.evidenceEntryIdxs ?? t?.evidenceEntryIdxs ?? []
  if (ev.length) selectTurns(ev)
}
function onSelectEdge(payload: { condition: string, from: string, to: string }) {
  selectedEdge.value = payload
  selectedNodeId.value = null
}

const criterionLabel = (criterionId: string) =>
  agent.value?.successCriteria.find(c => c.id === criterionId)?.label ?? criterionId

function criterionBarClass(score: number): string {
  const tone = scoreToneName(score)
  return cn(
    scoreToneSet(score).bg,
    tone === 'success' && '[&_[data-slot=progress-indicator]]:bg-success',
    tone === 'warning' && '[&_[data-slot=progress-indicator]]:bg-warning',
    tone === 'danger' && '[&_[data-slot=progress-indicator]]:bg-danger'
  )
}

/* Headline flow-alignment fraction for the hero stats. */
const flowTotal = computed(() => flowAlignment.value?.nodeAlignments.filter(a => a.status !== 'not_reached').length ?? 0)
const flowOnTrack = computed(() => flowAlignment.value?.nodeAlignments.filter(a => a.status === 'on_track').length ?? 0)

function fmtDuration(sec?: number): string {
  if (!sec) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Dim the analysis region while a fresh re-score runs over an existing analysis. */
const rescoringClass = computed(() =>
  running.value && hasAnalysis.value
    ? 'pointer-events-none select-none opacity-60 motion-safe:transition-opacity'
    : 'motion-safe:transition-opacity'
)

const entryCount = computed(() => transcript.value?.entries.length ?? 0)
</script>

<template>
  <div class="flex w-full flex-col gap-4 px-3 py-3 md:px-4 md:py-4">
    <!-- Loading -->
    <template v-if="pending">
      <Skeleton class="h-[120px] rounded-xl" />
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton class="h-[600px] rounded-xl" />
        <Skeleton class="h-[600px] rounded-xl" />
      </div>
    </template>

    <!-- Transport error -->
    <div
      v-else-if="error"
      class="mx-auto w-full max-w-md py-10"
    >
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Couldn't load this call</AlertTitle>
        <AlertDescription>
          <p>The call failed to load{{ error?.statusCode ? ` (error ${error.statusCode})` : '' }}. This is usually a temporary connection issue.</p>
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
    </div>

    <!-- Not found -->
    <div
      v-else-if="notFound || !transcript"
      class="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center"
    >
      <div class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox class="size-6" />
      </div>
      <div class="space-y-1">
        <h1 class="text-[18px] font-semibold">
          Call not found
        </h1>
        <p class="text-sm text-muted-foreground">
          This call may have been removed, or the link is out of date. Head back to the inbox to find it.
        </p>
      </div>
      <Button
        as-child
        variant="outline"
        size="sm"
      >
        <NuxtLink to="/calls">
          <Phone class="size-4" />
          Back to calls
        </NuxtLink>
      </Button>
    </div>

    <!-- Loaded -->
    <template v-else-if="call && agent">
      <!-- ============ HERO HEADER: summary + identity + scores ============ -->
      <SectionCard padding="dense">
        <div class="flex flex-col gap-3.5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <!-- Identity -->
            <div class="flex min-w-0 items-center gap-3">
              <span
                :class="cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-xl',
                  call.callType === 'LIVE' ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'
                )"
              >
                <component
                  :is="call.callType === 'LIVE' ? Radio : FlaskConical"
                  class="size-5"
                />
              </span>
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <NuxtLink
                    :to="`/agents/${agent.ghl.id}`"
                    class="rounded-md text-[17px] font-semibold tracking-tight text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {{ agent.ghl.agentName }}
                  </NuxtLink>
                  <Badge
                    variant="outline"
                    :class="cn(
                      'gap-1 rounded-md font-medium',
                      call.callType === 'LIVE' ? 'border-primary/40 text-primary' : 'text-muted-foreground'
                    )"
                  >
                    <component
                      :is="call.callType === 'LIVE' ? Radio : FlaskConical"
                      class="size-3"
                    />
                    {{ call.callType === 'LIVE' ? 'Live call' : 'Trial call' }}
                  </Badge>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground tabular-nums">
                  <span>{{ relativeTime(call.createdAt) }}</span>
                  <span class="inline-flex items-center gap-1">
                    <Clock class="size-3.5" /> {{ fmtDuration(call.durationSec) }}
                  </span>
                  <NuxtLink
                    :to="`/calls?agentId=${agent.ghl.id}`"
                    class="inline-flex items-center gap-0.5 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    All calls <ArrowUpRight class="size-3" />
                  </NuxtLink>
                </div>
              </div>
            </div>

            <!-- Scores + action -->
            <div class="flex flex-wrap items-stretch justify-end gap-2">
              <div
                v-if="analysis"
                class="flex flex-wrap items-center gap-2"
              >
                <div class="flex min-w-[64px] flex-col items-center rounded-lg border bg-card px-3 py-1.5">
                  <span :class="cn('text-[22px] font-semibold leading-none tabular-nums', scoreTone(analysis.scorecard.overall))">{{ Math.round(analysis.scorecard.overall) }}</span>
                  <span class="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Score</span>
                </div>
                <div
                  v-if="flowTotal"
                  class="flex min-w-[64px] flex-col items-center rounded-lg border bg-card px-3 py-1.5"
                >
                  <span class="text-[22px] font-semibold leading-none tabular-nums text-primary">{{ flowOnTrack }}<span class="text-[13px] text-muted-foreground">/{{ flowTotal }}</span></span>
                  <span class="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">On track</span>
                </div>
              </div>
              <Button
                size="sm"
                :variant="hasAnalysis ? 'outline' : 'default'"
                :disabled="analyzeBusy"
                class="self-center"
                @click="start(true)"
              >
                <RefreshCw :class="['size-4', analyzeBusy && 'motion-safe:animate-spin']" />
                {{ analyzeLabel }}
              </Button>
            </div>
          </div>

          <!-- Call summary (HighLevel-provided) — prominent, not truncated. -->
          <div
            v-if="call.summary"
            class="flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/[0.04] px-3 py-2.5"
          >
            <Sparkles class="mt-0.5 size-4 shrink-0 text-primary" />
            <p class="text-[13px] leading-relaxed text-foreground/90">
              <span class="font-medium text-foreground">Call summary · </span>{{ call.summary }}
            </p>
          </div>
        </div>
      </SectionCard>

      <!-- ============ BODY: analysis (primary) | transcript (rail) ============ -->
      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <!-- Analysis column -->
        <div class="flex min-w-0 flex-col gap-5">
          <!-- Live progress feed (while analyzing) -->
          <AnalysisProgress
            v-if="running || (errorMessage && !hasAnalysis)"
            :steps="steps"
            :running="running"
            :error="errorMessage"
          />

          <template v-if="analysis">
            <div :class="cn('flex flex-col gap-5', rescoringClass)">
              <!-- PRIMARY: flow drift (intended flow + this call's drift overlay) -->
              <SectionCard padding="dense">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <Route class="size-4" />
                    </span>
                    <div>
                      <h2 class="text-[15px] font-semibold leading-tight">
                        Expected vs actual
                      </h2>
                      <p class="text-[12px] text-muted-foreground">
                        The agent's intended flow, painted with where this call drifted.
                      </p>
                    </div>
                  </div>
                  <Badge
                    v-if="analysisIsFallback"
                    variant="destructive"
                    class="gap-1"
                  >
                    <AlertTriangle class="size-3" />
                    Deterministic fallback
                  </Badge>
                  <Badge
                    v-else
                    :class="cn('gap-1', toneClasses('success').badge)"
                  >
                    <Sparkles class="size-3" />
                    {{ analysis.model ? `Claude · ${analysis.model}` : 'Analyzed by Claude' }}
                  </Badge>
                </div>

                <div
                  v-if="hasFlow && inferredFlow"
                  class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
                >
                  <!-- The intended flow, painted with this call's drift + tangents. -->
                  <IntendedFlowGraph
                    :flow="inferredFlow"
                    :alignment="flowAlignment"
                    :selected-node-id="selectedNodeId"
                    height-class="h-[440px] lg:h-[620px]"
                    @select="onSelectNode"
                    @select-edge="onSelectEdge"
                  />
                  <!-- Intended vs actual vs how-to-fix for the selected node (right rail). -->
                  <FlowNodeDetail
                    class="lg:sticky lg:top-[4.5rem] lg:max-h-[620px] lg:overflow-y-auto"
                    :flow="inferredFlow"
                    :alignment="flowAlignment"
                    :selected-node-id="selectedNodeId"
                    :selected-edge="selectedEdge"
                    :active-entry-idxs="activeTurnIdxs"
                    @select="onSelectFlowEvidence"
                  />
                </div>
                <div
                  v-else
                  class="flex flex-col items-center gap-1.5 rounded-lg border border-dashed py-8 text-center"
                >
                  <span class="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Inbox class="size-4" />
                  </span>
                  <p class="text-sm font-semibold">
                    No flow baseline yet
                  </p>
                  <p class="max-w-xs text-sm text-muted-foreground">
                    This call hasn't been mapped against the agent's intended call flow yet. Re-run the analysis to build it.
                  </p>
                </div>
              </SectionCard>

              <!-- SECONDARY: scorecard + findings/recs/actions (compact) -->
              <SectionCard padding="dense">
                <div class="flex flex-col gap-4">
                  <div class="space-y-3">
                    <div class="flex items-center justify-between gap-2">
                      <h3 class="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Scorecard
                      </h3>
                    </div>
                    <p class="text-[13px] leading-relaxed text-muted-foreground">
                      {{ analysis.summary }}
                    </p>
                    <div class="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
                      <div
                        v-for="cs in analysis.scorecard.perCriterion"
                        :key="cs.criterionId"
                        class="space-y-1"
                      >
                        <div class="flex items-center justify-between gap-2 text-[13px]">
                          <span class="flex min-w-0 items-center gap-1.5">
                            <span :class="cn('size-1.5 shrink-0 rounded-full', cs.met ? 'bg-success' : 'bg-danger')" />
                            <span class="truncate font-medium">{{ criterionLabel(cs.criterionId) }}</span>
                          </span>
                          <span :class="cn('shrink-0 font-semibold tabular-nums', scoreTone(cs.score))">{{ Math.round(cs.score) }}</span>
                        </div>
                        <Progress
                          :model-value="cs.score"
                          :class="cn('h-1.5', criterionBarClass(cs.score))"
                        />
                      </div>
                    </div>
                  </div>

                  <Tabs
                    v-model="activeTab"
                    class="gap-3"
                  >
                    <TabsList class="w-full">
                      <TabsTrigger
                        value="findings"
                        class="flex-1"
                      >
                        Findings
                        <Badge
                          variant="secondary"
                          :class="cn('ml-1.5 rounded-full', !analysis.findings.length && 'text-muted-foreground')"
                        >
                          {{ analysis.findings.length }}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger
                        value="recs"
                        class="flex-1"
                      >
                        Fixes
                        <Badge
                          variant="secondary"
                          :class="cn('ml-1.5 rounded-full', !analysis.recommendations.length && 'text-muted-foreground')"
                        >
                          {{ analysis.recommendations.length }}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger
                        value="actions"
                        class="flex-1"
                      >
                        Use Actions
                        <Badge
                          variant="secondary"
                          :class="cn('ml-1.5 rounded-full', !analysis.useActions.length && 'text-muted-foreground')"
                        >
                          {{ analysis.useActions.length }}
                        </Badge>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent
                      value="findings"
                      class="flex flex-col gap-2.5"
                    >
                      <template v-if="analysis.findings.length">
                        <FindingCard
                          v-for="f in analysis.findings"
                          :key="f.id"
                          :finding="f"
                          :active="activeFindingId === f.id"
                          @select="selectFinding"
                        />
                      </template>
                      <div
                        v-else
                        class="flex flex-col items-center gap-1.5 rounded-lg border border-dashed py-6 text-center"
                      >
                        <span class="flex size-9 items-center justify-center rounded-full bg-success-soft text-success">
                          <Sparkles class="size-4" />
                        </span>
                        <p class="text-sm font-semibold">
                          No findings
                        </p>
                        <p class="max-w-xs text-sm text-muted-foreground">
                          This call stayed on its expected flow — nothing flagged.
                        </p>
                      </div>
                    </TabsContent>

                    <TabsContent
                      value="recs"
                      class="flex flex-col gap-2.5"
                    >
                      <template v-if="analysis.recommendations.length">
                        <RecommendationCard
                          v-for="rec in analysis.recommendations"
                          :key="rec.id"
                          :recommendation="rec"
                        />
                      </template>
                      <div
                        v-else
                        class="flex flex-col items-center gap-1.5 rounded-lg border border-dashed py-6 text-center"
                      >
                        <span class="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <ListChecks class="size-4" />
                        </span>
                        <p class="text-sm font-semibold">
                          No recommendations
                        </p>
                        <p class="max-w-xs text-sm text-muted-foreground">
                          Nothing to change for this call.
                        </p>
                      </div>
                    </TabsContent>

                    <TabsContent value="actions">
                      <UseActionList
                        :use-actions="analysis.useActions"
                        @focus="focusRange"
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              </SectionCard>
            </div>
          </template>

          <!-- Not analyzed yet (and not currently running) -->
          <SectionCard
            v-else-if="!running"
            padding="roomy"
          >
            <div class="flex flex-col items-center gap-4 py-12 text-center">
              <div class="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles class="size-6" />
              </div>
              <div class="space-y-1">
                <h3 class="text-[18px] font-semibold">
                  Not analyzed yet
                </h3>
                <p class="mx-auto max-w-xs text-sm text-muted-foreground">
                  Run the analyzer to map this agent's intended call flow, measure where this call drifted, and surface findings.
                </p>
              </div>
              <Button
                :disabled="analyzeBusy"
                @click="start(true)"
              >
                <Sparkles class="size-4" />
                {{ analyzeLabel }}
              </Button>
            </div>
          </SectionCard>
        </div>

        <!-- Transcript rail (compact CRM-dense artifact) -->
        <SectionCard
          title="Transcript"
          padding="dense"
          class="flex flex-col lg:sticky lg:top-[4.5rem]"
        >
          <template #actions>
            <span class="text-[12px] text-muted-foreground tabular-nums">{{ entryCount }} entries</span>
          </template>
          <TranscriptViewer
            compact
            viewport-class="h-[420px] pr-3 lg:h-[calc(100svh-12rem)]"
            :transcript="transcript"
            :evidence-idxs="evidenceIdxs"
            :use-actions="analysis?.useActions ?? []"
            :flash-idxs="flashIdxs"
            :active-turn-idxs="activeTurnIdxs"
            @select-turn="onSelectTurn"
          />
        </SectionCard>
      </div>
    </template>
  </div>
</template>
