<!-- CREATED (write-back flywheel) — review + apply slide-over for one
     recommendation's apply-ready patch: git-style diff, edit-before-apply, live
     PATCH to the GHL agent, echo-confirm, and 1-click revert. -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Check, GitCompare, Loader2, Pencil, Undo2 } from 'lucide-vue-next'
import type { Recommendation, ChangeEvent } from '#shared/types'
import { diffLines } from '#shared/diff'
import type { PatchDiffResult } from '~/composables/useApi'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter
} from '~/components/ui/sheet'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import DiffView from '~/components/DiffView.vue'
import SeverityBadge from '~/components/SeverityBadge.vue'

const props = defineProps<{
  open: boolean
  recommendation: Recommendation
  agentId?: string
  /** The target agent's display name — shown so the operator always knows WHICH
   *  live agent this write hits (critical on the fleet grid of mixed agents). */
  agentName?: string
  callId?: string
}>()
const emit = defineEmits<{ 'update:open': [boolean], 'applied': [ChangeEvent], 'reverted': [ChangeEvent] }>()

const { getPatchDiff, applyChanges, revertChange } = useApi()

const result = ref<PatchDiffResult | null>(null)
const pending = ref(false)
const error = ref<string | null>(null)

// Apply lifecycle
type Phase = 'review' | 'applying' | 'applied' | 'reverting'
const phase = ref<Phase>('review')
const applied = ref<ChangeEvent | null>(null)
const echoConfirmed = ref(true)
const actionError = ref<string | null>(null)

// Edit-before-apply (text targets only)
const editing = ref(false)
const editedAfter = ref('')

async function load() {
  result.value = null
  error.value = null
  actionError.value = null
  phase.value = 'review'
  applied.value = null
  editing.value = false
  const patch = props.recommendation.applyPatch
  if (!patch) {
    error.value = 'This recommendation has no apply-ready patch (apply manually via the snippet).'
    return
  }
  if (!props.agentId) {
    error.value = 'Missing agent id for this recommendation.'
    return
  }
  pending.value = true
  try {
    const r = await getPatchDiff(props.agentId, patch)
    result.value = r
    if (r.preview.kind === 'text') editedAfter.value = r.preview.after
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to compute the change preview.'
  } finally {
    pending.value = false
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) load()
})

const preview = computed(() => result.value?.preview)
const notApplicable = computed(() => preview.value && preview.value.applicable === false)
const isText = computed(() => preview.value?.kind === 'text')

// Live re-diff so edit-before-apply reflects the operator's tweaks.
const hunks = computed(() => {
  const p = preview.value
  if (p?.kind !== 'text') return result.value?.hunks ?? []
  return diffLines(p.before, editedAfter.value)
})
const stat = computed(() => {
  let additions = 0
  let deletions = 0
  for (const h of hunks.value) {
    for (const l of h.lines) {
      if (l.type === 'add') additions++
      else if (l.type === 'del') deletions++
    }
  }
  return { additions, deletions }
})

const dirty = computed(() => isText.value && preview.value?.kind === 'text' && editedAfter.value !== preview.value.after)

async function apply() {
  const patch = props.recommendation.applyPatch
  if (!patch || !props.agentId) return
  phase.value = 'applying'
  actionError.value = null
  try {
    const res = await applyChanges(props.agentId, [{
      applyPatch: patch,
      editedText: isText.value && dirty.value ? editedAfter.value : undefined,
      recommendationId: props.recommendation.id,
      callId: props.callId,
      title: props.recommendation.title
    }])
    const r = res.results[0]
    if (!r || !r.ok || !r.change) {
      actionError.value = r?.error ?? 'Apply failed.'
      phase.value = 'review'
      return
    }
    applied.value = r.change
    echoConfirmed.value = r.echoConfirmed !== false
    phase.value = 'applied'
    emit('applied', r.change)
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : 'Apply failed.'
    phase.value = 'review'
  }
}

async function revert() {
  if (!props.agentId || !applied.value) return
  phase.value = 'reverting'
  actionError.value = null
  try {
    const res = await revertChange(props.agentId, applied.value.id)
    phase.value = 'review'
    applied.value = null
    emit('reverted', res.change)
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : 'Revert failed.'
    phase.value = 'applied'
  }
}
</script>

<template>
  <Sheet
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <SheetContent
      side="right"
      class="flex w-full flex-col gap-0 sm:max-w-xl"
    >
      <SheetHeader class="border-b">
        <SheetTitle class="flex items-center gap-2">
          <GitCompare class="size-4" />
          Review change
          <Badge
            v-if="agentName"
            variant="outline"
            class="ml-1 max-w-[55%] truncate rounded-md font-medium"
          >
            {{ agentName }}
          </Badge>
        </SheetTitle>
        <SheetDescription>{{ recommendation.title }}</SheetDescription>
      </SheetHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div class="flex flex-wrap items-center gap-2 text-[12px]">
          <Badge
            v-if="preview"
            variant="outline"
            class="rounded-md font-medium"
          >
            {{ preview.label }}
          </Badge>
          <span class="flex items-center gap-1 text-muted-foreground">Impact <SeverityBadge :severity="recommendation.impact" /></span>
          <span
            v-if="isText && (stat.additions || stat.deletions)"
            class="font-mono text-muted-foreground"
          >
            <span class="text-emerald-600 dark:text-emerald-400">+{{ stat.additions }}</span>
            <span class="text-rose-600 dark:text-rose-400">−{{ stat.deletions }}</span>
          </span>
        </div>

        <p class="text-sm leading-relaxed text-muted-foreground">
          {{ recommendation.rationale }}
        </p>

        <div
          v-if="pending"
          class="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 class="size-4 animate-spin" /> Computing change preview…
        </div>
        <Alert
          v-else-if="error"
          variant="destructive"
        >
          <AlertTriangle class="size-4" />
          <AlertTitle>Can't preview this change</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <template v-else-if="preview">
          <!-- applied confirmation -->
          <Alert
            v-if="phase === 'applied'"
            class="border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
          >
            <Check class="size-4" />
            <AlertTitle>Applied to the live agent</AlertTitle>
            <AlertDescription>
              {{ echoConfirmed ? 'Confirmed persisted in HighLevel. A snapshot was saved — revert any time.' : 'Written, but echo-confirm was inconclusive. Verify in HighLevel.' }}
            </AlertDescription>
          </Alert>

          <Alert
            v-if="notApplicable && phase !== 'applied'"
            variant="destructive"
          >
            <AlertTriangle class="size-4" />
            <AlertTitle>Not auto-applicable</AlertTitle>
            <AlertDescription class="flex flex-col gap-2">
              <span>{{ 'error' in preview ? preview.error : 'The agent text changed since analysis.' }} Copy the suggested change below and apply it manually in HighLevel.</span>
              <pre class="overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-card p-2 font-mono text-[12px] text-foreground/90">{{ recommendation.suggestedChange }}</pre>
            </AlertDescription>
          </Alert>

          <DiffView
            v-if="isText"
            :hunks="hunks"
          />
          <div
            v-else-if="preview.kind === 'config'"
            class="overflow-hidden rounded-md border font-mono text-[12px]"
          >
            <div class="flex bg-rose-500/10">
              <span class="w-4 px-1 text-center text-rose-600 dark:text-rose-400">-</span>
              <span class="flex-1 px-2">{{ preview.field }}: {{ JSON.stringify(preview.oldValue) }}</span>
            </div>
            <div class="flex bg-emerald-500/10">
              <span class="w-4 px-1 text-center text-emerald-600 dark:text-emerald-400">+</span>
              <span class="flex-1 px-2">{{ preview.field }}: {{ JSON.stringify(preview.newValue) }}</span>
            </div>
          </div>

          <!-- edit-before-apply (text targets) -->
          <div
            v-if="isText && phase !== 'applied'"
            class="flex flex-col gap-2"
          >
            <Button
              variant="ghost"
              size="sm"
              class="self-start gap-1.5 text-muted-foreground"
              @click="editing = !editing"
            >
              <Pencil class="size-3.5" /> {{ editing ? 'Hide editor' : 'Edit before applying' }}
            </Button>
            <textarea
              v-if="editing"
              v-model="editedAfter"
              rows="8"
              class="w-full rounded-md border bg-card p-2 font-mono text-[12px] leading-relaxed focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>

          <Alert
            v-if="actionError"
            variant="destructive"
          >
            <AlertTriangle class="size-4" />
            <AlertTitle>Couldn't write to the agent</AlertTitle>
            <AlertDescription>{{ actionError }}</AlertDescription>
          </Alert>
        </template>
      </div>

      <SheetFooter class="flex-col gap-2 border-t sm:flex-col sm:space-x-0">
        <p class="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            This writes to the <span class="font-semibold text-foreground">live</span> HighLevel agent<span
              v-if="agentName"
              class="font-semibold text-foreground"
            > {{ agentName }}</span>{{ dirty ? ' (your edited version)' : '' }}. A snapshot is saved for 1-click revert.
          </span>
        </p>
        <div class="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="phase === 'applying' || phase === 'reverting'"
            @click="emit('update:open', false)"
          >
            Close
          </Button>
          <Button
            v-if="phase === 'applied' || phase === 'reverting'"
            variant="outline"
            size="sm"
            class="gap-1.5"
            :disabled="phase === 'reverting'"
            @click="revert"
          >
            <Loader2
              v-if="phase === 'reverting'"
              class="size-3.5 animate-spin"
            />
            <Undo2
              v-else
              class="size-3.5"
            />
            Revert
          </Button>
          <Button
            v-else
            size="sm"
            class="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90 dark:bg-amber-500 dark:hover:bg-amber-500/90"
            :disabled="!preview || notApplicable || phase === 'applying'"
            @click="apply"
          >
            <Loader2
              v-if="phase === 'applying'"
              class="size-3.5 animate-spin"
            />
            Apply to live agent
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
