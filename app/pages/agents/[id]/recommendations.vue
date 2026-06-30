<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { AlertTriangle, ArrowLeft, Check, ListChecks, Loader2, RotateCw, Wand2 } from 'lucide-vue-next'
import type { RecommendationItem, Severity } from '#shared/types'
import SectionCard from '~/components/SectionCard.vue'
import RecommendationCard from '~/components/RecommendationCard.vue'
import ChangesHistory from '~/components/ChangesHistory.vue'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Skeleton } from '~/components/ui/skeleton'
import { useTone } from '~/composables/useTone'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { toSentenceCase } from '~/lib/format'

/**
 * /agents/:id/recommendations — ONE agent's fix-queue (the canonical, only home
 * for recommendations; there is no fleet-wide route — recs are per-agent).
 *
 * Open fixes for this agent, grouped by impact (server ranks within band by
 * recency), each reviewable as a git-style diff and applyable straight to the
 * live agent, plus this agent's write-back change history.
 */
const route = useRoute()
const { getRecommendations, getChanges, applyChanges } = useApi()
const { severityTone, severityLabel } = useTone()
const { setBreadcrumb } = useBreadcrumb()

const agentId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = await useAsyncData(
  () => `agent-recs-${agentId.value}`,
  () => getRecommendations({ agentId: agentId.value }),
  { watch: [agentId] }
)

const { data: changesData, refresh: refreshChanges } = await useAsyncData(
  () => `agent-rec-changes-${agentId.value}`,
  () => getChanges({ agentId: agentId.value }),
  { watch: [agentId] }
)
const changes = computed(() => changesData.value ?? [])

/** Latest APPLIED (not reverted) change per recommendation id → the card's applied badge. */
const appliedByRec = computed(() => {
  const map: Record<string, (typeof changes.value)[number]> = {}
  for (const c of changes.value) {
    if (c.status === 'applied' && c.recommendationId) map[c.recommendationId] = c
  }
  return map
})

async function refreshAll() {
  await Promise.all([refresh(), refreshChanges()])
}

const items = computed<RecommendationItem[]>(() => data.value ?? [])
const agentName = computed(() => items.value[0]?.agentName ?? 'this agent')

/** Applicable = has an apply-ready patch and isn't already applied. */
const applicable = computed(() =>
  items.value.filter(it => it.recommendation.applyPatch && !appliedByRec.value[it.recommendation.id])
)

type BatchState = 'idle' | 'confirm' | 'applying' | 'done'
const batch = ref<BatchState>('idle')
const batchResult = ref<{ applied: number, failed: number } | null>(null)

async function batchApply() {
  batch.value = 'applying'
  // Single agent → one apply call; items run sequentially so an anchor invalidated
  // by an earlier edit surfaces as a per-item conflict rather than a silent clobber.
  let applied = 0
  let failed = 0
  try {
    const res = await applyChanges(agentId.value, applicable.value.map(it => ({
      applyPatch: it.recommendation.applyPatch!,
      recommendationId: it.recommendation.id,
      callId: it.callId,
      title: it.recommendation.title
    })))
    for (const r of res.results) {
      if (r.ok) applied++
      else failed++
    }
  } catch {
    failed = applicable.value.length
  }
  batchResult.value = { applied, failed }
  batch.value = 'done'
  await refreshAll()
}

/** Display-only sentence-case normalization (P15) — render-only, payload untouched. */
function toDisplayItem(it: RecommendationItem): RecommendationItem {
  return {
    ...it,
    recommendation: { ...it.recommendation, title: toSentenceCase(it.recommendation.title) }
  }
}

const isEmpty = computed(() => !pending.value && !error.value && items.value.length === 0)

/** Group into impact bands, highest first, preserving the server's intra-band order. */
const BANDS: Severity[] = ['high', 'medium', 'low']
const groups = computed(() =>
  BANDS
    .map(impact => ({
      impact,
      label: severityLabel(impact),
      items: items.value.filter(it => it.recommendation.impact === impact)
    }))
    .filter(g => g.items.length > 0)
)

const counts = computed(() => ({
  total: items.value.length,
  high: items.value.filter(i => i.recommendation.impact === 'high').length
}))

useHead(() => ({ title: `${agentName.value} · Recommendations` }))

// This route IS a child of the agent, so the trail nests correctly: the middle
// crumb's label is swapped to the resolved agent name (matches the route-derived
// shape Agents / Agent / Recommendations, so the override is accepted).
watchEffect(() => {
  setBreadcrumb([
    { label: 'Agents', to: '/agents' },
    { label: agentName.value === 'this agent' ? 'Agent' : agentName.value, to: `/agents/${agentId.value}` },
    { label: 'Recommendations' }
  ])
})

function itemKey(it: RecommendationItem): string {
  return `${it.recommendation.id}-${it.callId}`
}
</script>

<template>
  <div class="flex w-full flex-col gap-5 px-3 py-3 md:px-4 md:py-4">
    <!-- Page header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <NuxtLink
          :to="`/agents/${agentId}`"
          class="mb-1 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ArrowLeft class="size-3.5" /> Back to {{ agentName }}
        </NuxtLink>
        <h1 class="text-2xl font-semibold tracking-tight">
          Recommendations
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Open fixes for <span class="font-medium text-foreground">{{ agentName }}</span>, ranked by impact. Review each as a diff and apply it straight to the live agent.
        </p>
      </div>
      <div
        v-if="!pending && !error && items.length"
        class="flex flex-col items-end gap-2"
      >
        <div class="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
          <span>{{ counts.total }} open</span>
          <template v-if="counts.high">
            <span aria-hidden="true">·</span>
            <span :class="severityTone('high').text">{{ counts.high }} high impact</span>
          </template>
        </div>
        <!-- Batch apply all applicable patches for THIS agent. -->
        <div
          v-if="applicable.length"
          class="flex items-center gap-2"
        >
          <span
            v-if="batch === 'confirm'"
            class="max-w-[22rem] text-right text-[12px] text-muted-foreground"
          >Apply <span class="font-semibold text-foreground">{{ applicable.length }}</span> change(s) to the live agent
            <span class="font-medium text-foreground">{{ agentName }}</span>?</span>
          <Button
            v-if="batch === 'confirm'"
            variant="outline"
            size="sm"
            @click="batch = 'idle'"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            :class="batch === 'confirm' ? 'gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90 dark:bg-amber-500 dark:hover:bg-amber-500/90' : 'gap-1.5'"
            :disabled="batch === 'applying'"
            @click="batch === 'confirm' ? batchApply() : (batch = 'confirm')"
          >
            <Loader2
              v-if="batch === 'applying'"
              class="size-3.5 animate-spin"
            />
            <Wand2
              v-else
              class="size-3.5"
            />
            {{ batch === 'confirm' ? 'Confirm apply' : `Apply all (${applicable.length})` }}
          </Button>
        </div>
        <p
          v-if="batch === 'done' && batchResult"
          class="flex items-center gap-1 text-[12px] text-muted-foreground"
        >
          <Check class="size-3.5 text-emerald-600 dark:text-emerald-400" />
          Applied {{ batchResult.applied }}{{ batchResult.failed ? `, ${batchResult.failed} failed/conflicted` : '' }}
        </p>
      </div>
    </div>

    <!-- Write-back change history for this agent (applied / reverted) -->
    <ChangesHistory
      :changes="changes"
      @changed="refreshAll"
    />

    <!-- Loading -->
    <div
      v-if="pending"
      class="flex flex-col gap-6"
    >
      <div
        v-for="band in 2"
        :key="band"
        class="flex flex-col gap-3"
      >
        <Skeleton class="h-5 w-32 rounded-md" />
        <div class="grid gap-3 md:grid-cols-2">
          <Skeleton
            v-for="i in 2"
            :key="i"
            class="h-44 rounded-xl"
          />
        </div>
      </div>
    </div>

    <!-- Error -->
    <Alert
      v-else-if="error"
      variant="destructive"
    >
      <AlertTriangle />
      <AlertTitle>Couldn't load recommendations</AlertTitle>
      <AlertDescription class="flex flex-col items-start gap-3">
        <span>The request failed{{ error?.statusCode ? ` (${error.statusCode})` : '' }}. Your connection may have dropped, or the analysis store is temporarily unavailable.</span>
        <Button
          variant="outline"
          size="sm"
          @click="refresh()"
        >
          <RotateCw class="size-4" /> Try again
        </Button>
      </AlertDescription>
    </Alert>

    <!-- Empty -->
    <SectionCard
      v-else-if="isEmpty"
      class="border-dashed"
    >
      <div class="flex flex-col items-center justify-center gap-4 py-14 text-center">
        <div class="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ListChecks class="size-6" />
        </div>
        <div class="space-y-1">
          <h2 class="text-[18px] font-semibold">
            No open fixes for this agent
          </h2>
          <p class="mx-auto max-w-sm text-sm text-muted-foreground">
            Every analyzed call for this agent is following its expected flow. Review more calls to surface concrete prompt, flow, and config fixes here.
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <Button
            as-child
            variant="outline"
            size="sm"
          >
            <NuxtLink :to="`/agents/${agentId}`">
              Back to agent
            </NuxtLink>
          </Button>
          <Button
            as-child
            size="sm"
          >
            <NuxtLink :to="`/calls?agentId=${agentId}`">
              Review calls
            </NuxtLink>
          </Button>
        </div>
      </div>
    </SectionCard>

    <!-- Fix-queue, grouped by impact band -->
    <template v-else>
      <section
        v-for="group in groups"
        :key="group.impact"
        class="flex flex-col gap-3"
        :aria-label="`${group.label} impact recommendations`"
      >
        <div class="flex items-center gap-2.5">
          <span
            :class="['flex size-2 rounded-full', severityTone(group.impact).dot]"
            aria-hidden="true"
          />
          <h2 class="text-[18px] font-semibold tracking-tight">
            {{ group.label }} impact
          </h2>
          <span class="rounded-full bg-muted px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted-foreground">
            {{ group.items.length }}
          </span>
        </div>

        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <RecommendationCard
            v-for="(it, i) in group.items"
            :key="`${group.impact}-${i}-${itemKey(it)}`"
            :item="toDisplayItem(it)"
            :applied-change="appliedByRec[it.recommendation.id]"
            hide-agent-link
            @changed="refreshAll"
          />
        </div>
      </section>
    </template>
  </div>
</template>
