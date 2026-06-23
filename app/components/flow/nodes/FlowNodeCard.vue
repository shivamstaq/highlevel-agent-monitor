<script setup lang="ts">
// CREATED (our eval layer) — the single custom Vue Flow node renderer.
/**
 * FlowNodeCard — the one custom node component registered with <FlowCanvas> for
 * every FlowNodeType. The node TYPE (trigger/llm/router/action/endCall) is shown
 * by an icon + neutral type chip that echoes GHL Agent Studio's node language;
 * the conformance STATUS (hit/skipped/out_of_order/extra) is a separate overlay
 * ring + badge so the two channels never collide.
 *
 * Vue Flow hands us the node via `data` (we stash our payload under data.payload
 * in FlowCanvas). Handles are rendered top (target) + bottom (source) so the
 * graph flows downward, matching the captured uiNodes geometry.
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { FlowNodeData, FlowNodeType, NodeStatus } from '#shared/types'
import { nodeTypeMeta, STATUS_OVERLAY } from './nodeMeta'
import { cn } from '~/lib/utils'

interface NodePayload {
  flowType: FlowNodeType
  flowData: FlowNodeData
  status?: NodeStatus
  selected?: boolean
}

const props = defineProps<{
  /** Vue Flow node data — we read our payload off `data.payload`. */
  data: { payload: NodePayload }
}>()

const payload = computed(() => props.data.payload)
const meta = computed(() => nodeTypeMeta(payload.value.flowType))
const overlay = computed(() => (payload.value.status ? STATUS_OVERLAY[payload.value.status] : null))

const title = computed(() => payload.value.flowData.displayName)
const toolCount = computed(() => payload.value.flowData.tools?.length ?? 0)
const transitionCount = computed(() => payload.value.flowData.transitions?.length ?? 0)
const hasPrompt = computed(() => Boolean(payload.value.flowData.prompt?.trim()))
</script>

<template>
  <div
    :class="cn(
      'group relative w-[210px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow',
      'hover:shadow-md',
      overlay?.ring,
      payload.selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
    )"
  >
    <!-- Top target handle (incoming) — hidden on the start/trigger node visually but kept for layout. -->
    <Handle
      v-if="payload.flowType !== 'trigger'"
      type="target"
      :position="Position.Top"
      class="!size-2 !border-2 !border-background !bg-muted-foreground/50"
    />

    <div class="flex items-start gap-2 px-3 pt-2.5">
      <div :class="cn('flex size-7 shrink-0 items-center justify-center rounded-md', meta.chip)">
        <component
          :is="meta.icon"
          class="size-4"
        />
      </div>
      <div class="min-w-0 flex-1">
        <p
          class="truncate text-[13px] font-semibold leading-tight"
          :title="title"
        >
          {{ title }}
        </p>
        <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {{ meta.label }}
        </p>
      </div>
      <span
        v-if="overlay"
        :class="cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', overlay.badge)"
      >
        {{ overlay.label }}
      </span>
    </div>

    <!-- Compact meta row: prompt / tools / transitions presence. -->
    <div
      v-if="hasPrompt || toolCount || transitionCount"
      class="mt-2 flex flex-wrap items-center gap-1 border-t px-3 py-1.5 text-[10px] text-muted-foreground"
    >
      <span
        v-if="hasPrompt"
        class="rounded bg-muted px-1.5 py-0.5"
      >Prompt</span>
      <span
        v-if="toolCount"
        class="rounded bg-muted px-1.5 py-0.5 font-mono"
      >{{ toolCount }} tool{{ toolCount === 1 ? '' : 's' }}</span>
      <span
        v-if="transitionCount"
        class="rounded bg-muted px-1.5 py-0.5 font-mono"
      >{{ transitionCount }} branch{{ transitionCount === 1 ? '' : 'es' }}</span>
    </div>

    <!-- Bottom source handle (outgoing) — endCall is terminal, no source. -->
    <Handle
      v-if="payload.flowType !== 'endCall'"
      type="source"
      :position="Position.Bottom"
      class="!size-2 !border-2 !border-background !bg-muted-foreground/50"
    />
  </div>
</template>
