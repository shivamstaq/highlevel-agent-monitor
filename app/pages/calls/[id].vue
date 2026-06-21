<script setup lang="ts">
import type { Finding } from '#shared/types'
import { computed, ref } from 'vue'
import { ArrowLeft, Clock, RefreshCw, Sparkles, User } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
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

const route = useRoute()
const id = computed(() => route.params.id as string)
const { getCall, analyzeCall } = useApi()

const { data, pending, refresh } = await useAsyncData(`call-${id.value}`, () => getCall(id.value))

const call = computed(() => data.value?.call)
const agent = computed(() => data.value?.agent)
const analysis = computed(() => data.value?.analysis)
const transcript = computed(() => data.value?.transcript)
const timeline = computed(() => data.value?.timeline)
const expectedFlow = computed(() => data.value?.expectedFlow)
const flowAlignment = computed(() => data.value?.analysis?.flowAlignment)

/** Shared highlight state between scorecard findings and the transcript. */
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
  if (f.evidenceTurnIdxs.length) {
    flashIdxs.value = [...f.evidenceTurnIdxs]
  }
}

function focusRange(range: [number, number]) {
  const [a, b] = range
  const out: number[] = []
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
  flashIdxs.value = out
}

/** Cross-highlight from the timeline (one turn) and the flow-drift panel (a node's turns). */
function focusTurn(turnIdx: number) {
  flashIdxs.value = [turnIdx]
}
function focusIdxs(turnIdxs: number[]) {
  if (turnIdxs.length) flashIdxs.value = [...turnIdxs]
}

const criterionLabel = (criterionId: string) =>
  agent.value?.successCriteria.find(c => c.id === criterionId)?.label ?? criterionId

const reanalyzing = ref(false)
async function reanalyze() {
  reanalyzing.value = true
  try {
    await analyzeCall(id.value, true)
    toast.success('Analysis refreshed')
    await refresh()
  } catch {
    toast.error('Re-analysis failed')
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

function scoreTone(n: number): string {
  if (n >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (n >= 60) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 md:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <NuxtLink
        :to="agent ? `/agents/${agent.id}` : '/'"
        class="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft class="size-4" /> Back
      </NuxtLink>
      <Button
        size="sm"
        variant="outline"
        :disabled="reanalyzing || pending"
        @click="reanalyze"
      >
        <RefreshCw :class="['size-4', reanalyzing && 'animate-spin']" />
        {{ reanalyzing ? 'Analyzing…' : 'Re-analyze' }}
      </Button>
    </div>

    <template v-if="pending">
      <Skeleton class="h-[80px] rounded-xl" />
      <div class="grid gap-5 lg:grid-cols-2">
        <Skeleton class="h-[600px] rounded-xl" />
        <Skeleton class="h-[600px] rounded-xl" />
      </div>
    </template>

    <template v-else-if="call && agent && transcript">
      <!-- Call header -->
      <Card class="gap-0 py-0">
        <CardContent class="flex flex-wrap items-center justify-between gap-4 p-4">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div class="flex items-center gap-2">
              <span class="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <User class="size-4" />
              </span>
              <div class="flex flex-col leading-tight">
                <span class="text-sm font-semibold">{{ call.contactName || 'Unknown contact' }}</span>
                <span class="text-xs text-muted-foreground">{{ agent.name }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock class="size-4" /> {{ fmtDuration(call.durationSec) }}
            </div>
            <Badge
              variant="outline"
              class="capitalize"
            >
              {{ call.direction }}
            </Badge>
            <Badge
              v-if="call.outcome"
              variant="secondary"
              class="font-medium"
            >
              {{ call.outcome }}
            </Badge>
          </div>

          <div
            v-if="analysis"
            class="flex items-center gap-5"
          >
            <div
              v-if="flowAlignment"
              class="text-right"
            >
              <div class="text-xs text-muted-foreground">
                Flow conformance
              </div>
              <div :class="['text-3xl font-semibold leading-none tabular-nums', scoreTone(flowAlignment.conformanceScore)]">
                {{ Math.round(flowAlignment.conformanceScore) }}
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs text-muted-foreground">
                Overall score
              </div>
              <div :class="['text-3xl font-semibold leading-none tabular-nums', scoreTone(analysis.scorecard.overall)]">
                {{ Math.round(analysis.scorecard.overall) }}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Two columns -->
      <div class="grid gap-5 lg:grid-cols-2">
        <!-- Left: transcript -->
        <Card class="flex flex-col gap-0 py-0">
          <CardHeader class="flex-row items-center justify-between border-b py-3.5">
            <CardTitle class="text-base">
              Transcript
            </CardTitle>
            <span class="text-xs text-muted-foreground">{{ transcript.turns.length }} turns</span>
          </CardHeader>
          <CardContent class="p-4">
            <TranscriptViewer
              :transcript="transcript"
              :evidence-idxs="evidenceIdxs"
              :use-actions="analysis?.useActions ?? []"
              :flash-idxs="flashIdxs"
            />
          </CardContent>
        </Card>

        <!-- Right: scorecard / findings / recs / use-actions -->
        <div class="flex flex-col gap-5">
          <template v-if="analysis">
            <!-- Summary + scorecard -->
            <Card class="gap-0 py-0">
              <CardHeader class="border-b py-3.5">
                <CardTitle class="text-base">
                  Scorecard
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-4 p-4">
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
                      <span class="flex items-center gap-2 truncate">
                        <span
                          class="size-1.5 shrink-0 rounded-full"
                          :class="cs.met ? 'bg-emerald-500' : 'bg-red-500'"
                        />
                        <span class="truncate font-medium">{{ criterionLabel(cs.criterionId) }}</span>
                      </span>
                      <span :class="['shrink-0 tabular-nums font-semibold', scoreTone(cs.score)]">{{ Math.round(cs.score) }}</span>
                    </div>
                    <Progress
                      :model-value="cs.score"
                      class="h-1.5"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <!-- Tabbed detail -->
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
                    class="ml-1.5"
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
                    class="ml-1.5"
                  >
                    {{ analysis.recommendations.length }}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="actions"
                  class="flex-1"
                >
                  Use-actions
                  <Badge
                    variant="secondary"
                    class="ml-1.5"
                  >
                    {{ analysis.useActions.length }}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  v-if="flowAlignment && expectedFlow"
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
                  <p class="px-1 text-xs text-muted-foreground">
                    Tip: click a finding to highlight the cited turns in the transcript.
                  </p>
                </template>
                <Card
                  v-else
                  class="border-dashed"
                >
                  <CardContent class="py-8 text-center text-sm text-muted-foreground">
                    No findings — this call followed the playbook.
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent
                value="recs"
                class="flex flex-col gap-3"
              >
                <RecommendationCard
                  v-for="rec in analysis.recommendations"
                  :key="rec.id"
                  :recommendation="rec"
                />
                <Card
                  v-if="!analysis.recommendations.length"
                  class="border-dashed"
                >
                  <CardContent class="py-8 text-center text-sm text-muted-foreground">
                    No recommendations for this call.
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="actions">
                <UseActionList
                  :use-actions="analysis.useActions"
                  @focus="focusRange"
                />
              </TabsContent>

              <TabsContent
                v-if="flowAlignment && expectedFlow"
                value="flow"
              >
                <FlowDrift
                  :flow="expectedFlow"
                  :alignment="flowAlignment"
                  @select-node="focusIdxs"
                />
              </TabsContent>
            </Tabs>
          </template>

          <!-- Not analyzed yet -->
          <Card
            v-else
            class="border-dashed"
          >
            <CardContent class="flex flex-col items-center gap-4 py-14 text-center">
              <div class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles class="size-6" />
              </div>
              <div class="space-y-1">
                <h3 class="font-semibold">
                  Not analyzed yet
                </h3>
                <p class="mx-auto max-w-xs text-sm text-muted-foreground">
                  Run the QA analyzer to score this call, surface findings, and generate coaching recommendations.
                </p>
              </div>
              <Button
                :disabled="reanalyzing"
                @click="reanalyze"
              >
                <Sparkles class="size-4" />
                {{ reanalyzing ? 'Analyzing…' : 'Analyze call' }}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <!-- Full-width: realtime voice-pipeline event timeline -->
      <Card
        v-if="timeline"
        class="gap-0 py-0"
      >
        <CardHeader class="flex-row items-center justify-between border-b py-3.5">
          <div>
            <CardTitle class="text-base">
              Call event timeline
            </CardTitle>
            <p class="text-xs text-muted-foreground">
              Realtime pipeline: VAD → STT → endpoint → LLM → TTS → audio
            </p>
          </div>
        </CardHeader>
        <CardContent class="p-4">
          <CallTimeline
            :timeline="timeline"
            @select-turn="focusTurn"
          />
        </CardContent>
      </Card>
    </template>

    <Card
      v-else
      class="border-dashed"
    >
      <CardContent class="py-16 text-center text-sm text-muted-foreground">
        Call not found.
      </CardContent>
    </Card>
  </div>
</template>
