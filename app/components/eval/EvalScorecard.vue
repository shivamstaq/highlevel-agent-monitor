<script setup lang="ts">
// CREATED (our eval layer) — the per-call QA scorecard (overall + per-criterion).
/**
 * EvalScorecard — renders the analysis Scorecard for one call: the headline
 * overall QA score (0–100) plus each success criterion's met/score/evidence.
 * Criterion labels + kind are joined from the agent's derived successCriteria
 * (criterionId → SuccessCriterion); scores come from analysis.scorecard. All
 * status color routes through useTone (no raw palette utilities).
 */
import { computed } from 'vue'
import { Check, X } from 'lucide-vue-next'
import type { Scorecard, SuccessCriterion } from '#shared/types'
import { Badge } from '~/components/ui/badge'
import { useTone } from '~/composables/useTone'
import { cn } from '~/lib/utils'

const props = defineProps<{
  scorecard: Scorecard
  /** The agent's derived criteria, for label + kind lookup. */
  criteria: SuccessCriterion[]
}>()

const { scoreToneName, scoreToneSet, toneClasses } = useTone()

const criterionById = computed(() =>
  new Map(props.criteria.map(c => [c.id, c]))
)

const overall = computed(() => Math.round(props.scorecard.overall))
const overallTone = computed(() => scoreToneSet(overall.value))

const rows = computed(() =>
  props.scorecard.perCriterion.map((s) => {
    const c = criterionById.value.get(s.criterionId)
    return {
      ...s,
      label: c?.label ?? s.criterionId,
      kind: c?.kind ?? null,
      weight: c?.weight ?? null
    }
  })
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Headline overall -->
    <div class="flex items-center gap-4">
      <div
        :class="cn(
          'flex size-16 shrink-0 flex-col items-center justify-center rounded-xl',
          overallTone.bg
        )"
      >
        <span :class="cn('text-2xl font-semibold leading-none tabular-nums', overallTone.text)">
          {{ overall }}
        </span>
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold">
          Overall QA score
        </p>
        <p class="text-[13px] text-muted-foreground">
          Weighted across {{ rows.length }} success criterion{{ rows.length === 1 ? '' : 's' }} derived from the agent's prompt and flow.
        </p>
      </div>
    </div>

    <!-- Per-criterion -->
    <div
      v-if="rows.length"
      class="flex flex-col divide-y rounded-lg border"
    >
      <div
        v-for="r in rows"
        :key="r.criterionId"
        class="flex items-start gap-3 p-3"
      >
        <span
          :class="cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
            r.met ? toneClasses('success').badge : toneClasses('danger').badge
          )"
        >
          <component
            :is="r.met ? Check : X"
            class="size-3.5"
          />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">{{ r.label }}</span>
            <Badge
              v-if="r.kind"
              variant="outline"
              class="rounded-md text-[10px] capitalize"
            >
              {{ r.kind }}
            </Badge>
          </div>
          <p
            v-if="r.evidence"
            class="text-[13px] leading-relaxed text-muted-foreground"
          >
            {{ r.evidence }}
          </p>
        </div>
        <span
          :class="cn('shrink-0 text-sm font-semibold tabular-nums', toneClasses(scoreToneName(r.score)).text)"
        >
          {{ Math.round(r.score) }}
        </span>
      </div>
    </div>

    <p
      v-else
      class="text-sm text-muted-foreground"
    >
      No per-criterion breakdown for this call.
    </p>
  </div>
</template>
