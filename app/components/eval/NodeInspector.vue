<script setup lang="ts">
// BORROWED (GHL replica) — read-only inspector for a single Agent Studio flow node.
/**
 * NodeInspector — the click-to-inspect side panel for a FlowCanvas node. Shows
 * the BORROWED node config exactly as GHL Agent Studio exposes it: the node type,
 * its system prompt, attached tools, and outgoing NL transitions. Read-only — we
 * mirror the agent design, we never write back to GHL.
 *
 * Bound to the normalized FlowNode contract (shared/ghl.ts). When no node is
 * selected it renders a hint to click a node in the canvas.
 */
import { computed } from 'vue'
import { ArrowRight, Wrench } from 'lucide-vue-next'
import type { FlowGraph, FlowNode } from '#shared/types'
import { Badge } from '~/components/ui/badge'
import { nodeTypeMeta } from '~/components/flow/nodes/nodeMeta'
import { cn } from '~/lib/utils'

const props = defineProps<{
  graph: FlowGraph
  selectedNodeId?: string
}>()

const node = computed<FlowNode | undefined>(() =>
  props.graph.nodes.find(n => n.id === props.selectedNodeId)
)

const meta = computed(() => (node.value ? nodeTypeMeta(node.value.type) : null))

/** Resolve a transition target nodeId to its display name for readable rules. */
function targetName(to: string | undefined): string {
  if (!to) return ''
  return props.graph.nodes.find(n => n.id === to)?.data.displayName ?? to
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div
      v-if="node && meta"
      class="flex flex-col gap-4"
    >
      <!-- Identity -->
      <div class="flex items-start gap-2.5">
        <div :class="cn('flex size-8 shrink-0 items-center justify-center rounded-md', meta.chip)">
          <component
            :is="meta.icon"
            class="size-4"
          />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-semibold leading-tight">
            {{ node.data.displayName }}
          </p>
          <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {{ meta.label }}
          </p>
        </div>
      </div>

      <!-- Prompt -->
      <div
        v-if="node.data.prompt?.trim()"
        class="flex flex-col gap-1.5"
      >
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Prompt
        </p>
        <div class="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-3">
          <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
            {{ node.data.prompt }}
          </p>
        </div>
      </div>

      <!-- Tools -->
      <div
        v-if="node.data.tools?.length"
        class="flex flex-col gap-1.5"
      >
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Tools
        </p>
        <div class="flex flex-wrap gap-1.5">
          <Badge
            v-for="t in node.data.tools"
            :key="t"
            variant="outline"
            class="gap-1 rounded-md font-mono text-[11px]"
          >
            <Wrench class="size-3" />
            {{ t }}
          </Badge>
        </div>
      </div>

      <!-- Transitions -->
      <div
        v-if="node.data.transitions?.length"
        class="flex flex-col gap-1.5"
      >
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Transitions
        </p>
        <ul class="flex flex-col gap-1.5">
          <li
            v-for="(tr, i) in node.data.transitions"
            :key="i"
            class="flex items-start gap-2 rounded-md border bg-card px-2.5 py-1.5 text-[13px]"
          >
            <ArrowRight class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0">
              <span class="text-foreground">{{ tr.condition }}</span>
              <span
                v-if="tr.to"
                class="text-muted-foreground"
              >
                → {{ targetName(tr.to) }}</span>
              <span
                v-if="tr.toolName"
                class="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground"
              >{{ tr.toolName }}</span>
            </span>
          </li>
        </ul>
      </div>

      <p
        v-if="!node.data.prompt?.trim() && !node.data.tools?.length && !node.data.transitions?.length"
        class="text-sm text-muted-foreground"
      >
        This node carries no prompt, tools, or transitions.
      </p>
    </div>

    <!-- Empty: nothing selected -->
    <div
      v-else
      class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center"
    >
      <p class="text-sm font-medium text-foreground">
        Inspect a node
      </p>
      <p class="max-w-[22ch] text-[13px] text-muted-foreground">
        Click any node in the flow to read its prompt, tools, and transitions.
      </p>
    </div>
  </div>
</template>
