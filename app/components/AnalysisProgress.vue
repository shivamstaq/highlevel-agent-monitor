<script setup lang="ts">
/**
 * AnalysisProgress — the live, reactive step-by-step feedback shown while a call
 * is being analyzed. Renders the AnalysisStatus.steps (pending / active / done /
 * skipped / error) so the operator sees exactly what the analysis agent is doing
 * right now. Driven entirely by props (state lives in useAnalysis).
 */
import type { AnalysisStep, AnalysisStepState } from '#shared/types'
import { computed } from 'vue'
import { Check, CircleDashed, Loader2, Minus, Sparkles, X } from 'lucide-vue-next'
import { cn } from '~/lib/utils'

const props = defineProps<{
  steps: AnalysisStep[]
  /** True while the run is active (drives the header spinner + pulse). */
  running?: boolean
  /** Error text when the run failed. */
  error?: string
}>()

const doneCount = computed(() => props.steps.filter(s => s.state === 'done' || s.state === 'skipped').length)
const total = computed(() => props.steps.length)

function meta(state: AnalysisStepState) {
  switch (state) {
    case 'active': return { icon: Loader2, spin: true, ring: 'text-primary', label: 'text-foreground font-medium' }
    case 'done': return { icon: Check, spin: false, ring: 'text-success', label: 'text-foreground' }
    case 'skipped': return { icon: Minus, spin: false, ring: 'text-muted-foreground', label: 'text-muted-foreground' }
    case 'error': return { icon: X, spin: false, ring: 'text-danger', label: 'text-danger' }
    default: return { icon: CircleDashed, spin: false, ring: 'text-muted-foreground/50', label: 'text-muted-foreground' }
  }
}
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-b from-primary/[0.06] to-transparent">
    <div class="flex items-center gap-2.5 border-b border-primary/15 bg-primary/[0.04] px-4 py-3">
      <span class="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Sparkles class="size-4" />
        <span
          v-if="running"
          class="absolute inset-0 animate-ping rounded-lg bg-primary/20"
        />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold leading-tight">
          {{ error ? 'Analysis failed' : running ? 'Analyzing this call…' : 'Analysis complete' }}
        </p>
        <p class="text-[12px] text-muted-foreground">
          {{ error ? error : total ? `${doneCount} of ${total} steps` : 'Starting…' }}
        </p>
      </div>
      <Loader2
        v-if="running"
        class="size-4 shrink-0 animate-spin text-primary"
      />
    </div>

    <ol class="flex flex-col gap-0.5 p-3">
      <li
        v-if="!steps.length && running"
        class="flex items-center gap-2.5 px-1 py-1.5 text-sm text-muted-foreground"
      >
        <Loader2 class="size-4 animate-spin text-primary" />
        Spinning up the analysis pipeline…
      </li>
      <li
        v-for="step in steps"
        :key="step.id"
        :class="cn(
          'flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors duration-[var(--dur)] ease-[var(--ease)]',
          step.state === 'active' && 'bg-primary/[0.06]'
        )"
      >
        <component
          :is="meta(step.state).icon"
          :class="cn('size-4 shrink-0', meta(step.state).ring, meta(step.state).spin && 'animate-spin')"
        />
        <span :class="cn('min-w-0 flex-1 truncate text-sm', meta(step.state).label)">
          {{ step.label }}
        </span>
        <span
          v-if="step.detail"
          class="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          {{ step.detail }}
        </span>
      </li>
    </ol>
  </div>
</template>
