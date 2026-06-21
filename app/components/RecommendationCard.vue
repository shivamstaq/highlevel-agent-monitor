<script setup lang="ts">
import type { Recommendation, RecommendationItem } from '#shared/types'
import { computed, ref } from 'vue'
import { ArrowUpRight, Check, Copy, FileText, GraduationCap, Phone, Settings2, SlidersHorizontal, User } from 'lucide-vue-next'
import SectionCard from '~/components/SectionCard.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import SeverityBadge from '~/components/SeverityBadge.vue'
import { cn } from '~/lib/utils'

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
}>(), {
  compact: false
})

const rec = computed<Recommendation | undefined>(() => props.recommendation ?? props.item?.recommendation)

const callId = computed(() => props.sourceCallId ?? props.item?.callId)
const agentId = computed(() => props.sourceAgentId ?? props.item?.agentId)
const agentLabel = computed(() => props.sourceLabel ?? props.item?.agentName)
const callLabel = computed(() => props.item?.contactName?.trim() || 'View call')

const targetMeta = computed(() => {
  switch (rec.value?.target) {
    case 'prompt':
      return { label: 'System prompt', icon: SlidersHorizontal }
    case 'script':
      return { label: 'Call script', icon: FileText }
    case 'agent_config':
      return { label: 'Agent config', icon: Settings2 }
    default:
      return { label: 'Coaching', icon: GraduationCap }
  }
})

const hasSource = computed(() => Boolean(callId.value || agentId.value))

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
          {{ rec.title }}
        </p>
      </div>

      <p class="text-sm leading-relaxed text-muted-foreground">
        {{ rec.rationale }}
      </p>

      <div
        v-if="!compact && rec.suggestedChange"
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

      <!-- Deep-links to the source call / agent (W09). -->
      <div
        v-if="hasSource"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3"
      >
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
          v-if="agentId"
          :to="`/agents/${agentId}`"
          class="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <User class="size-3.5" />
          <span class="truncate">{{ agentLabel ?? 'View agent' }}</span>
          <ArrowUpRight class="size-3" />
        </NuxtLink>
      </div>
    </div>
  </SectionCard>
</template>
