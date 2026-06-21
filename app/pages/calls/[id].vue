<script setup lang="ts">
import type { Finding } from '#shared/types'
import { computed, ref, watchEffect } from 'vue'
import {
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Inbox,
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
import TranscriptViewer from '~/components/TranscriptViewer.vue'
import FindingCard from '~/components/FindingCard.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import UseActionList from '~/components/UseActionList.vue'
import CallTimeline from '~/components/CallTimeline.vue'
import FlowDrift from '~/components/FlowDrift.vue'
import { useApi } from '~/composables/useApi'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

const route = useRoute()
const id = computed(() => route.params.id as string)
const { getCall, analyzeCall } = useApi()
const { setBreadcrumb } = useBreadcrumb()
const { scoreTone } = useTone()

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
 * flow-drift and the transcript.
 * ------------------------------------------------------------------------- */
const flashIdxs = ref<number[]>([])
const activeFindingId = ref<string | null>(null)

const evidenceIdxs = computed(() => {
  const set = new Set<number>()
  for (const f of analysis.value?.findings ?? []) {
    for (const i of f.evidenceTurnIdxs) set.add(i)
  }
  return [...set]
})

function selectFinding(f: Finding) {
  activeFindingId.value = f.id
  if (f.evidenceTurnIdxs.length) flashIdxs.value = [...f.evidenceTurnIdxs]
}

function focusRange(range: [number, number]) {
  const [a, b] = range
  const out: number[] = []
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
  flashIdxs.value = out
}

function focusTurn(turnIdx: number) {
  flashIdxs.value = [turnIdx]
}
function focusIdxs(turnIdxs: number[]) {
  if (turnIdxs.length) flashIdxs.value = [...turnIdxs]
}

const criterionLabel = (criterionId: string) =>
  agent.value?.successCriteria.find(c => c.id === criterionId)?.label ?? criterionId

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
              {{ call.outcome }}
            </Badge>
          </div>

          <div class="flex items-center gap-5">
            <div
              v-if="flowAlignment"
              class="text-right"
            >
              <div class="text-[12px] text-muted-foreground">
                Flow adherence
              </div>
              <div :class="cn('text-[30px] font-semibold leading-none tabular-nums', scoreTone(flowAlignment.conformanceScore))">
                {{ Math.round(flowAlignment.conformanceScore) }}
              </div>
            </div>
            <div
              v-if="analysis"
              class="text-right"
            >
              <div class="text-[12px] text-muted-foreground">
                Script adherence
              </div>
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
                      class="h-1.5"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <!-- Tabbed detail. Flow-drift slot always renders (W36) so the strip
                 doesn't reflow per call. -->
            <Tabs
              default-value="findings"
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
        title="Voice Pipeline Timeline"
        description="Where latency is spent across the realtime pipeline — caller, STT/VAD, endpoint, LLM, TTS, agent."
        padding="dense"
        :class="rescoringClass"
      >
        <CallTimeline
          :timeline="timeline"
          @select-turn="focusTurn"
        />
      </SectionCard>
    </template>
  </div>
</template>
