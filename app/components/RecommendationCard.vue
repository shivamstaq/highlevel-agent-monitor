<!-- CREATED (our eval layer) — heterogeneous fix card. `target` spans the
     contract set: prompt | flow_node | agent_config | training. -->
<script setup lang="ts">
import type { Recommendation, RecommendationItem, ChangeEvent } from '#shared/types'
import { computed, ref } from 'vue'
import { ArrowUpRight, Check, CircleCheck, Copy, GitBranch, GitCompare, GraduationCap, Loader2, Phone, Repeat2, Settings2, SlidersHorizontal, Undo2, User } from 'lucide-vue-next'
import SectionCard from '~/components/SectionCard.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import SeverityBadge from '~/components/SeverityBadge.vue'
import ChangeReviewSheet from '~/components/ChangeReviewSheet.vue'
import { cn } from '~/lib/utils'
import { toSentenceCase } from '~/lib/format'

/**
 * RecommendationCard — heterogeneous fix card (title + rationale + paste-ready
 * snippet). Deep-links back to its source call/agent (W09) so the Overview
 * "Top recommendations" feed and agent recommendations stop being dead leaves.
 *
 * Source can be passed either as a whole `RecommendationItem` (preferred — the
 * fleet/agent feeds carry it) or via discrete `recommendation` + source props.
 */
const props = withDefaults(defineProps<{
  /** The recommendation itself. Required unless `item` is supplied. */
  recommendation?: Recommendation
  /** A source-tagged recommendation; supplies recommendation + deep-link targets. */
  item?: RecommendationItem
  /** Deep-link to the source call (e.g. /calls/:id). */
  sourceCallId?: string
  /** Deep-link to the source agent (e.g. /agents/:id). */
  sourceAgentId?: string
  /** Override the link label (defaults to the agent / contact name). */
  sourceLabel?: string
  /** Hide the suggested-change code block (compact list contexts). */
  compact?: boolean
  /** An applied write-back change for this recommendation (drives the Applied/Revert state). */
  appliedChange?: ChangeEvent
  /** Suppress the "View agent" deep-link + cross-agent recurrence (agent context is
   *  already established by the surrounding page/group — avoids a self-link). */
  hideAgentLink?: boolean
}>(), {
  compact: false,
  hideAgentLink: false
})
const emit = defineEmits<{ changed: [] }>()

const rec = computed<Recommendation | undefined>(() => props.recommendation ?? props.item?.recommendation)

/**
 * Display-only title normalization (P15). Model-authored titles drift between
 * Title Case and sentence case in the same grid; normalize on render so the
 * fix-queue reads consistently. This is a presentation transform — the raw
 * `rec.title` data is never mutated.
 */
const displayTitle = computed(() => toSentenceCase(rec.value?.title))

const callId = computed(() => props.sourceCallId ?? props.item?.callId)
const agentId = computed(() => props.sourceAgentId ?? props.item?.agentId)
const agentLabel = computed(() => props.sourceLabel ?? props.item?.agentName)
const callLabel = computed(() => 'View call')

const targetMeta = computed(() => {
  switch (rec.value?.target) {
    case 'prompt':
      return { label: 'System prompt', icon: SlidersHorizontal }
    case 'flow_node':
      return { label: 'Flow node', icon: GitBranch }
    case 'agent_config':
      return { label: 'Agent config', icon: Settings2 }
    default:
      return { label: 'Training', icon: GraduationCap }
  }
})

/**
 * Recurrence chip (P10): the rollup deduped this same advice across calls and
 * agents — surface the bucket size so a systemic multi-agent script bug reads
 * differently from a one-off. Only meaningful when the source is an item that
 * actually carries the counts and the advice recurs (callCount > 1).
 */
const callCount = computed(() => props.item?.callCount ?? 0)
const agentCount = computed(() => props.item?.agentCount ?? 0)
const recurs = computed(() => callCount.value > 1)
const agentNames = computed(() => props.item?.agentNames ?? [])
const recurrenceLabel = computed(() => {
  const calls = `${callCount.value} call${callCount.value === 1 ? '' : 's'}`
  // The cross-agent count is a fleet signal — meaningless (and confusing) when the
  // card is shown inside a single agent's scope, so suppress it there.
  if (agentCount.value > 1 && !props.hideAgentLink) {
    return `Seen on ${calls}, ${agentCount.value} agents`
  }
  return `Seen on ${calls}`
})

/**
 * Write-back review (Phase 2): when the analysis emitted an apply-ready patch and
 * we know the target agent, offer a git-style diff review slide-over. Falls back
 * to the copy-snippet path otherwise.
 */
const reviewOpen = ref(false)
const canReview = computed(() => Boolean(rec.value?.applyPatch && agentId.value))

/** Applied-state (persisted): an applied (not reverted) change for this rec. */
const isApplied = computed(() => props.appliedChange?.status === 'applied')
const reverting = ref(false)
// Revert is another LIVE write, so it gets a 2-step confirm (click → confirm).
const revertConfirm = ref(false)
const { revertChange } = useApi()
async function revertApplied() {
  if (!agentId.value || !props.appliedChange) return
  if (!revertConfirm.value) {
    revertConfirm.value = true
    setTimeout(() => (revertConfirm.value = false), 4000)
    return
  }
  revertConfirm.value = false
  reverting.value = true
  try {
    await revertChange(agentId.value, props.appliedChange.id)
    emit('changed')
  } finally {
    reverting.value = false
  }
}
function onApplied() {
  emit('changed')
}

const copied = ref(false)
const copyStatus = ref('')
async function copy() {
  const text = rec.value?.suggestedChange
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    copyStatus.value = 'Copied to clipboard'
    setTimeout(() => {
      copied.value = false
      copyStatus.value = ''
    }, 1600)
  } catch {
    copied.value = false
    copyStatus.value = 'Couldn\'t copy — select the snippet and copy manually.'
    setTimeout(() => (copyStatus.value = ''), 4000)
  }
}
</script>

<template>
  <SectionCard
    v-if="rec"
    padding="dense"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            class="gap-1 rounded-md text-[12px] font-medium"
          >
            <component
              :is="targetMeta.icon"
              class="size-3"
            />
            {{ targetMeta.label }}
          </Badge>
          <span class="flex items-center gap-1 text-[12px] text-muted-foreground">
            Impact
            <SeverityBadge :severity="rec.impact" />
          </span>
        </div>
        <p class="text-sm font-semibold leading-snug">
          {{ displayTitle }}
        </p>
      </div>

      <p class="text-sm leading-relaxed text-muted-foreground">
        {{ rec.rationale }}
      </p>

      <div
        v-if="isApplied"
        class="flex flex-wrap items-center gap-2"
      >
        <Badge class="gap-1 rounded-md border-transparent bg-emerald-500/15 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
          <CircleCheck class="size-3.5" />
          Applied to live agent
        </Badge>
        <Button
          :variant="revertConfirm ? 'destructive' : 'outline'"
          size="sm"
          class="gap-1.5"
          :disabled="reverting"
          @click="revertApplied"
        >
          <Loader2
            v-if="reverting"
            class="size-3.5 animate-spin"
          />
          <Undo2
            v-else
            class="size-3.5"
          />
          {{ revertConfirm ? 'Confirm revert' : 'Revert' }}
        </Button>
      </div>
      <div v-else-if="canReview">
        <Button
          variant="default"
          size="sm"
          class="gap-1.5"
          @click="reviewOpen = true"
        >
          <GitCompare class="size-3.5" />
          Review &amp; apply
        </Button>
      </div>

      <div
        v-if="!compact && rec.suggestedChange && !isApplied"
        class="relative rounded-md border bg-muted/50 p-3"
      >
        <pre class="overflow-x-auto whitespace-pre-wrap break-words pr-9 font-mono text-xs leading-relaxed text-foreground/90">{{ rec.suggestedChange }}</pre>
        <Button
          variant="ghost"
          size="icon-sm"
          class="absolute right-1.5 top-1.5"
          :aria-label="copied ? 'Copied' : 'Copy suggested change'"
          @click="copy"
        >
          <component
            :is="copied ? Check : Copy"
            :class="cn('size-3.5', copied && 'text-success')"
          />
        </Button>
        <p
          class="sr-only"
          role="status"
          aria-live="polite"
        >
          {{ copyStatus }}
        </p>
      </div>

      <p
        v-if="copyStatus && !copied"
        class="text-[12px] text-danger"
      >
        {{ copyStatus }}
      </p>

      <!-- Recurrence chip (P10) + deep-links to the source call / agent (W09). -->
      <div
        v-if="callId || recurs || (agentId && !hideAgentLink)"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3"
      >
        <Badge
          v-if="recurs"
          variant="secondary"
          class="gap-1 rounded-full border-transparent bg-muted text-[12px] font-medium text-muted-foreground"
          :title="agentNames.length ? `Raised by ${agentNames.join(', ')}` : undefined"
        >
          <Repeat2 class="size-3" />
          {{ recurrenceLabel }}
        </Badge>
        <NuxtLink
          v-if="callId"
          :to="`/calls/${callId}`"
          class="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Phone class="size-3.5" />
          <span class="truncate">{{ callLabel }}</span>
          <ArrowUpRight class="size-3" />
        </NuxtLink>
        <NuxtLink
          v-if="agentId && !hideAgentLink"
          :to="`/agents/${agentId}`"
          class="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <User class="size-3.5" />
          <span class="truncate">{{ agentLabel ?? 'View agent' }}</span>
          <ArrowUpRight class="size-3" />
        </NuxtLink>
      </div>
    </div>

    <ChangeReviewSheet
      v-if="rec && canReview"
      v-model:open="reviewOpen"
      :recommendation="rec"
      :agent-id="agentId"
      :agent-name="agentLabel"
      :call-id="callId"
      @applied="onApplied"
      @reverted="onApplied"
    />
  </SectionCard>
</template>
