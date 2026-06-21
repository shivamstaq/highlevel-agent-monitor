<script setup lang="ts">
import type { Finding } from '#shared/types'
import { computed, ref, watchEffect } from 'vue'
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  Clock,
  Inbox,
  Info,
  ListChecks,
  Phone,
  RefreshCw,
  RotateCw,
  Sparkles,
  User
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import SectionCard from '~/components/SectionCard.vue'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Skeleton } from '~/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '~/components/ui/tooltip'
import TranscriptViewer from '~/components/TranscriptViewer.vue'
import FindingCard from '~/components/FindingCard.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import UseActionList from '~/components/UseActionList.vue'
import CallTimeline from '~/components/CallTimeline.vue'
import FlowDrift from '~/components/FlowDrift.vue'
import { useApi } from '~/composables/useApi'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { useTone } from '~/composables/useTone'
import { humanizeOutcome } from '~/lib/format'
import { cn } from '~/lib/utils'

const route = useRoute()
const id = computed(() => route.params.id as string)
const { getCall, analyzeCall } = useApi()
const { setBreadcrumb } = useBreadcrumb()
const { scoreTone, scoreToneName, scoreToneSet } = useTone()

const { data, pending, error, refresh } = await useAsyncData(`call-${id.value}`, () => getCall(id.value))

const call = computed(() => data.value?.call)
const agent = computed(() => data.value?.agent)
const analysis = computed(() => data.value?.analysis)
const transcript = computed(() => data.value?.transcript)
const timeline = computed(() => data.value?.timeline)
const expectedFlow = computed(() => data.value?.expectedFlow)
const flowAlignment = computed(() => data.value?.analysis?.flowAlignment)

/** A 404 = the fetch resolved but the entity is missing (vs a transport error). */
const notFound = computed(() => !pending.value && !error.value && !data.value?.call)

const contactName = computed(() => call.value?.contactName?.trim() || 'Unknown contact')

/* Breadcrumb + page title resolve once the entity name is known. */
useHead({ title: computed(() => (call.value ? `${contactName.value} · Call` : 'Call')) })
watchEffect(() => {
  setBreadcrumb([
    { label: 'Calls', to: '/calls' },
    { label: call.value ? contactName.value : 'Call' }
  ])
})

/* ----------------------------------------------------------------------------
 * Shared cross-highlight state between findings / use-actions / timeline /
 * flow-drift and the transcript (P13 / spec W19).
 *
 * Two layers:
 *   · `flashIdxs` — a transient (1.6s) bg-tint flash, the SCROLL cue when a
 *     surface points at turns. Kept as an additional cue.
 *   · `activeTurnIdxs` — the PERSISTED selection: the accent ring that stays
 *     painted on the transcript and the timeline bar until the selection
 *     changes. This is what makes the cross-highlight a real two-way link
 *     rather than a momentary flash.
 *
 * Every entry point (a clicked transcript turn, a timeline bar, a flow node,
 * a finding, a use-action range) sets BOTH: it persists the selection AND
 * fires a flash so the transcript scrolls to it.
 * ------------------------------------------------------------------------- */
const flashIdxs = ref<number[]>([])
const activeTurnIdxs = ref<number[]>([])
const activeFindingId = ref<string | null>(null)

/** Controlled tab so the compact Flow-adherence card can deep-link into Flow drift (P12). */
const activeTab = ref('findings')

const evidenceIdxs = computed(() => {
  const set = new Set<number>()
  for (const f of analysis.value?.findings ?? []) {
    for (const i of f.evidenceTurnIdxs) set.add(i)
  }
  return [...set]
})

/**
 * The single active turn the timeline rings (CallTimeline takes one idx). When a
 * range is selected we anchor on its lowest turn so the timeline + transcript
 * agree on a single accented bar.
 */
const activeTurnIdx = computed<number | null>(() =>
  activeTurnIdxs.value.length ? Math.min(...activeTurnIdxs.value) : null
)

/** Persist a turn selection + flash-scroll to it (the shared primitive). */
function selectTurns(turnIdxs: number[]) {
  if (turnIdxs.length) {
    activeTurnIdxs.value = [...turnIdxs]
    flashIdxs.value = [...turnIdxs]
  }
}

function selectFinding(f: Finding) {
  activeFindingId.value = f.id
  selectTurns(f.evidenceTurnIdxs)
}

function focusRange(range: [number, number]) {
  const [a, b] = range
  const out: number[] = []
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
  activeFindingId.value = null
  selectTurns(out)
}

/** A clicked / keyboarded timeline bar — persist its turn everywhere (P13). */
function focusTurn(turnIdx: number) {
  activeFindingId.value = null
  selectTurns([turnIdx])
}

/**
 * A clicked flow-drift node — FlowDrift emits the matched turn indices for the
 * node, so we persist those turns. (FlowDrift owns its own active-node visuals
 * via the turns it cited; we don't reach into its node id here.)
 */
function focusIdxs(turnIdxs: number[]) {
  activeFindingId.value = null
  selectTurns(turnIdxs)
}

/** A clicked / keyboarded transcript turn — persist it so timeline stays in sync. */
function onSelectTurn(turnIdx: number) {
  activeFindingId.value = null
  selectTurns([turnIdx])
}

const criterionLabel = (criterionId: string) =>
  agent.value?.successCriteria.find(c => c.id === criterionId)?.label ?? criterionId

/**
 * Per-criterion Progress bar tone (R3-04/P20). The indicator was teal for every
 * criterion, so a failed criterion (red dot + red number, score 0–20) still
 * showed a teal/healthy bar that softened the red-flag result. Tone the
 * indicator AND a chroma-matched soft track by the criterion's own score band —
 * exactly like FlowDrift's conformance bar — so the bar reinforces the dot +
 * number instead of contradicting them. Override only the indicator fill via the
 * data-slot selector so we keep using the shared <Progress> + useTone, never raw
 * color utilities.
 */
function criterionBarClass(score: number): string {
  const tone = scoreToneName(score)
  return cn(
    scoreToneSet(score).bg,
    tone === 'success' && '[&_[data-slot=progress-indicator]]:bg-success',
    tone === 'warning' && '[&_[data-slot=progress-indicator]]:bg-warning',
    tone === 'danger' && '[&_[data-slot=progress-indicator]]:bg-danger'
  )
}

/* ----------------------------------------------------------------------------
 * P12 — always-visible compact Flow adherence summary.
 *
 * Flow adherence (differentiator #2) otherwise lives only behind the 4th tab.
 * Surface a persistent compact card under the scorecard: the score + band + a
 * one-line expected-vs-actual sentence derived from flowAlignment.actualPath,
 * naming what was skipped vs. what actually happened. The full drift list stays
 * in the Flow drift tab.
 * ------------------------------------------------------------------------- */
const flowScore = computed(() => flowAlignment.value?.conformanceScore ?? null)
const flowToneSet = computed(() => scoreToneSet(flowScore.value))
const flowBandLabel = computed(() => {
  const band = scoreToneName(flowScore.value)
  if (band === 'success') return 'On track'
  if (band === 'warning') return 'Some drift'
  if (band === 'danger') return 'Significant drift'
  return 'Not measured'
})

/** Required (expected) nodes that the call skipped — the headline gap. */
const flowSkippedLabels = computed(() => {
  const al = flowAlignment.value
  if (!al) return []
  return al.nodeAlignments
    .filter(na => na.status === 'skipped' && na.nodeId
      && (expectedFlow.value?.nodes.find(n => n.id === na.nodeId)?.expected ?? true))
    .map(na => na.label)
})

/** Count of nodes the call actually traversed (length of the real path). */
const flowActualCount = computed(() => flowAlignment.value?.actualPath.length ?? 0)

/** Out-of-order / extra steps that drifted from the design. */
const flowDriftedCount = computed(() =>
  flowAlignment.value?.nodeAlignments
    .filter(na => na.status !== 'hit' && na.driftScore > 0).length ?? 0
)

/**
 * One-line expected-vs-actual sentence (P12). Honest: it states the count of
 * required steps the call walked vs. what it skipped, never inventing detail.
 */
const flowSummaryLine = computed(() => {
  const al = flowAlignment.value
  if (!al) return ''
  const skipped = flowSkippedLabels.value
  const walked = flowActualCount.value
  const expectedTotal = (expectedFlow.value?.nodes ?? []).filter(n => n.expected).length
  if (skipped.length) {
    const head = skipped.slice(0, 2).join(', ')
    const more = skipped.length > 2 ? ` +${skipped.length - 2} more` : ''
    return `Walked ${walked} of ${expectedTotal} expected steps — skipped ${head}${more}.`
  }
  if (flowDriftedCount.value > 0) {
    return `Hit every expected step, but ${flowDriftedCount.value} drifted (out of order or unplanned).`
  }
  return `Followed all ${expectedTotal} expected steps in the designed order.`
})

/* ----------------------------------------------------------------------------
 * Re-analyze (W12) — overlay the scorecard/tabs/timeline with a re-scoring
 * state while the round-trip runs; the transcript stays readable.
 * ------------------------------------------------------------------------- */
const reanalyzing = ref(false)
const hasAnalysis = computed(() => Boolean(analysis.value))

async function reanalyze() {
  if (reanalyzing.value) return
  reanalyzing.value = true
  const wasAnalyzed = hasAnalysis.value
  try {
    await toast.promise(
      analyzeCall(id.value, true).then(() => refresh()),
      {
        loading: wasAnalyzed ? 'Re-scoring this call…' : 'Analyzing call…',
        success: wasAnalyzed ? 'Analysis updated' : 'Call analyzed',
        error: 'Couldn\'t analyze this call — try again.'
      }
    )
  } finally {
    reanalyzing.value = false
  }
}

function fmtDuration(sec?: number): string {
  if (!sec) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Dim the analysis region while re-scoring (W12). */
const rescoringClass = computed(() =>
  reanalyzing.value && hasAnalysis.value
    ? 'pointer-events-none select-none opacity-60 motion-safe:transition-opacity'
    : 'motion-safe:transition-opacity'
)
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-4 md:p-6">
    <!-- Loading -->
    <template v-if="pending">
      <Skeleton class="h-[88px] rounded-xl" />
      <div class="grid gap-6 lg:grid-cols-2">
        <Skeleton class="h-[600px] rounded-xl" />
        <Skeleton class="h-[600px] rounded-xl" />
      </div>
    </template>

    <!-- Transport error (W03) — distinct from not-found below. -->
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

    <!-- Not found — resolved, but the call doesn't exist. -->
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
      <!-- Call header -->
      <SectionCard padding="dense">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div class="flex items-center gap-2.5">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <User class="size-4" />
              </span>
              <div class="flex flex-col leading-tight">
                <span class="text-sm font-semibold">{{ contactName }}</span>
                <!-- Agent name -> agent detail (W31) -->
                <NuxtLink
                  :to="`/agents/${agent.id}`"
                  class="w-fit rounded-md text-[12px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {{ agent.name }}
                </NuxtLink>
              </div>
            </div>

            <div class="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
              <Clock class="size-4" /> {{ fmtDuration(call.durationSec) }}
            </div>
            <Badge
              variant="outline"
              class="rounded-md capitalize"
            >
              {{ call.direction }}
            </Badge>
            <Badge
              v-if="call.outcome"
              variant="secondary"
              class="rounded-md font-medium"
            >
              {{ humanizeOutcome(call.outcome) }}
            </Badge>
          </div>

          <TooltipProvider :delay-duration="120">
            <div class="flex items-center gap-5">
              <!-- Flow adherence (= conformanceScore) — defined on first use (P04/P09/P16). -->
              <div
                v-if="flowAlignment"
                class="text-right"
              >
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-md text-[12px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:text-foreground"
                      aria-label="What is Flow adherence?"
                    >
                      Flow adherence
                      <Info class="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="max-w-xs text-xs leading-relaxed">
                    How closely this call followed its expected flow — every
                    required step hit, in the designed order (0–100).
                  </TooltipContent>
                </Tooltip>
                <div :class="cn('text-[30px] font-semibold leading-none tabular-nums', scoreTone(flowAlignment.conformanceScore))">
                  {{ Math.round(flowAlignment.conformanceScore) }}
                </div>
              </div>
              <!-- Call score (= scorecard.overall) — renamed from "Script adherence" (P04). -->
              <div
                v-if="analysis"
                class="text-right"
              >
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-md text-[12px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:text-foreground"
                      aria-label="What is Call score?"
                    >
                      Call score
                      <Info class="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent class="max-w-xs text-xs leading-relaxed">
                    The overall weighted QA score for this call (0–100), across
                    every success criterion — outcome, behavior, compliance, tone.
                  </TooltipContent>
                </Tooltip>
                <div :class="cn('text-[30px] font-semibold leading-none tabular-nums', scoreTone(analysis.scorecard.overall))">
                  {{ Math.round(analysis.scorecard.overall) }}
                </div>
              </div>

              <div class="flex flex-col items-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  :disabled="reanalyzing"
                  @click="reanalyze"
                >
                  <RefreshCw :class="['size-4', reanalyzing && 'motion-safe:animate-spin']" />
                  {{ reanalyzing ? 'Analyzing…' : (analysis ? 'Re-run analysis' : 'Analyze call') }}
                </Button>
                <NuxtLink
                  :to="`/calls?agentId=${agent.id}`"
                  class="inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  View all calls
                  <ArrowUpRight class="size-3" />
                </NuxtLink>
              </div>
            </div>
          </TooltipProvider>
        </div>
      </SectionCard>

      <!-- Two columns: transcript | scorecard + tabs -->
      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Transcript (stays readable while re-scoring) -->
        <SectionCard
          title="Transcript"
          padding="dense"
          class="flex flex-col"
        >
          <template #actions>
            <span class="text-[12px] text-muted-foreground tabular-nums">{{ transcript.turns.length }} turns</span>
          </template>
          <TranscriptViewer
            :transcript="transcript"
            :evidence-idxs="evidenceIdxs"
            :use-actions="analysis?.useActions ?? []"
            :flash-idxs="flashIdxs"
            :active-turn-idxs="activeTurnIdxs"
            @select-turn="onSelectTurn"
          />
        </SectionCard>

        <!-- Scorecard + tabs (dimmed while re-scoring, W12) -->
        <div :class="cn('flex flex-col gap-6', rescoringClass)">
          <template v-if="analysis">
            <SectionCard
              title="Scorecard"
              padding="dense"
            >
              <div class="flex flex-col gap-4">
                <p class="text-sm leading-relaxed text-muted-foreground">
                  {{ analysis.summary }}
                </p>
                <div class="space-y-3">
                  <div
                    v-for="cs in analysis.scorecard.perCriterion"
                    :key="cs.criterionId"
                    class="space-y-1.5"
                  >
                    <div class="flex items-center justify-between gap-2 text-sm">
                      <span class="flex min-w-0 items-center gap-2">
                        <span
                          :class="cn('size-1.5 shrink-0 rounded-full', cs.met ? 'bg-success' : 'bg-danger')"
                        />
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
            </SectionCard>

            <!-- P12 — always-visible compact Flow adherence summary.
                 Surfaces differentiator #2 at the same altitude as Findings,
                 with a one-line expected-vs-actual from actualPath. The full
                 drift list stays in the Flow drift tab (deep-linked below). -->
            <SectionCard
              v-if="flowAlignment"
              padding="dense"
            >
              <div class="flex flex-col gap-3">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <div class="flex items-center gap-1.5">
                      <span class="text-[12px] font-medium text-muted-foreground">
                        Flow adherence
                      </span>
                      <span :class="cn('rounded-full px-1.5 py-0.5 text-[11px] font-medium', flowToneSet.badge)">
                        {{ flowBandLabel }}
                      </span>
                    </div>
                    <p class="text-sm leading-snug text-muted-foreground">
                      {{ flowSummaryLine }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-end gap-0.5">
                    <span :class="cn('text-[24px] font-semibold leading-none tabular-nums', flowToneSet.text)">
                      {{ Math.round(flowAlignment.conformanceScore) }}
                    </span>
                    <span class="pb-0.5 text-[12px] text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="inline-flex w-fit items-center gap-1 rounded-md text-[12px] font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:underline"
                  @click="activeTab = 'flow'"
                >
                  See full flow drift
                  <ChevronRight class="size-3.5" />
                </button>
              </div>
            </SectionCard>

            <!-- Tabbed detail. Flow-drift slot always renders (W36) so the strip
                 doesn't reflow per call. -->
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
                  Recommendations
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
                <TabsTrigger
                  value="flow"
                  class="flex-1"
                >
                  Flow drift
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="findings"
                class="flex flex-col gap-3"
              >
                <template v-if="analysis.findings.length">
                  <FindingCard
                    v-for="f in analysis.findings"
                    :key="f.id"
                    :finding="f"
                    :active="activeFindingId === f.id"
                    @select="selectFinding"
                  />
                  <p class="px-1 text-[12px] text-muted-foreground">
                    Tip: select a finding to highlight the cited turns in the transcript.
                  </p>
                </template>
                <SectionCard
                  v-else
                  padding="roomy"
                >
                  <div class="flex flex-col items-center gap-1.5 py-6 text-center">
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
                </SectionCard>
              </TabsContent>

              <TabsContent
                value="recs"
                class="flex flex-col gap-3"
              >
                <template v-if="analysis.recommendations.length">
                  <RecommendationCard
                    v-for="rec in analysis.recommendations"
                    :key="rec.id"
                    :recommendation="rec"
                  />
                </template>
                <SectionCard
                  v-else
                  padding="roomy"
                >
                  <div class="flex flex-col items-center gap-1.5 py-6 text-center">
                    <span class="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <ListChecks class="size-4" />
                    </span>
                    <p class="text-sm font-semibold">
                      No recommendations
                    </p>
                    <p class="max-w-xs text-sm text-muted-foreground">
                      Nothing to change for this call. Re-run analysis if the transcript changed.
                    </p>
                  </div>
                </SectionCard>
              </TabsContent>

              <TabsContent value="actions">
                <UseActionList
                  :use-actions="analysis.useActions"
                  @focus="focusRange"
                />
              </TabsContent>

              <TabsContent value="flow">
                <FlowDrift
                  v-if="flowAlignment && expectedFlow"
                  :flow="expectedFlow"
                  :alignment="flowAlignment"
                  @select-node="focusIdxs"
                />
                <SectionCard
                  v-else
                  padding="roomy"
                >
                  <div class="flex flex-col items-center gap-1.5 py-6 text-center">
                    <span class="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Inbox class="size-4" />
                    </span>
                    <p class="text-sm font-semibold">
                      No flow baseline
                    </p>
                    <p class="max-w-xs text-sm text-muted-foreground">
                      This agent has no expected call flow yet, so there's nothing to measure drift against.
                    </p>
                  </div>
                </SectionCard>
              </TabsContent>
            </Tabs>
          </template>

          <!-- Not analyzed yet -->
          <SectionCard
            v-else
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
                  Run the analyzer to score this call, surface findings, and generate coaching recommendations.
                </p>
              </div>
              <Button
                :disabled="reanalyzing"
                @click="reanalyze"
              >
                <Sparkles class="size-4" />
                {{ reanalyzing ? 'Analyzing…' : 'Analyze call' }}
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      <!-- The signature: Voice Pipeline Timeline in ONE SectionCard (W08).
           CallTimeline renders standalone — no second header. -->
      <SectionCard
        v-if="timeline"
        title="Voice pipeline timeline"
        description="Where latency is spent across the realtime pipeline — caller, STT/VAD, endpoint, LLM, TTS, agent. Per-stage timing is modeled (reconstructed from published budgets, scaled to this call's real duration), not directly measured."
        padding="dense"
        :class="rescoringClass"
      >
        <CallTimeline
          :timeline="timeline"
          :duration-sec="call.durationSec"
          :active-turn-idx="activeTurnIdx"
          @select-turn="focusTurn"
        />
      </SectionCard>
    </template>
  </div>
</template>
