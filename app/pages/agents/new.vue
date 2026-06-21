<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue'
import { ArrowRight, CheckCircle2, Loader2, Sparkles, Wand2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { Agent, ExpectedFlow } from '#shared/types'
import SectionCard from '~/components/SectionCard.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import FlowDiagram from '~/components/FlowDiagram.vue'
import { useBreadcrumb } from '~/composables/useBreadcrumb'
import { cn } from '~/lib/utils'

/**
 * /agents/new — create an agent (W27/W38).
 *
 * Pre-creation collapses to a centered single form column; the expected-flow
 * panel reveals after create. Validation is inline (aria-invalid + helper),
 * the primary button is disabled until name + goal are non-empty, and the verb
 * spine reads Create agent / Creating… / Open agent. The server derives the
 * success criteria + expected call flow at creation — the observability
 * baseline every future call is measured against.
 */
const { createAgent } = useApi()
const { setBreadcrumb } = useBreadcrumb()

useHead({ title: 'New agent' })

watchEffect(() => {
  setBreadcrumb([
    { label: 'Agents', to: '/agents' },
    { label: 'New agent' }
  ])
})

const form = reactive({
  name: '',
  goal: '',
  script: ''
})

const submitting = ref(false)
const submitted = ref(false)
const created = ref<{ agent: Agent, flow: ExpectedFlow } | null>(null)

/** Field-level validity — surfaced only after a submit attempt. */
const nameError = computed(() => (form.name.trim() ? '' : 'Give the agent a name.'))
const goalError = computed(() => (form.goal.trim() ? '' : 'Describe what a successful call achieves.'))
const canSubmit = computed(() => !nameError.value && !goalError.value)

const locked = computed(() => submitting.value || Boolean(created.value))

const example = {
  name: 'Solar Lead Qualifier',
  goal: 'Qualify inbound solar leads: confirm homeownership, average monthly electric bill, and roof type, then book a consultation for qualified leads.',
  script: 'Greet warmly and introduce yourself as the solar advisor. Confirm the caller owns their home. Ask for their average monthly electric bill and roof type. If they qualify (homeowner, bill > $80), offer two consultation slots and confirm one. Read back the appointment. Thank them and close.'
}

function useExample() {
  form.name = example.name
  form.goal = example.goal
  form.script = example.script
}

async function submit() {
  submitted.value = true
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const res = await createAgent({
      name: form.name.trim(),
      goal: form.goal.trim(),
      script: form.script.trim()
    })
    created.value = res
    toast.success('Agent created', {
      description: `Designed a ${res.flow.nodes.length}-step expected call flow.`
    })
  } catch {
    toast.error('Couldn\'t create the agent', {
      description: 'The request failed. Check your details and try again.'
    })
  } finally {
    submitting.value = false
  }
}

function reset() {
  created.value = null
  submitted.value = false
  form.name = ''
  form.goal = ''
  form.script = ''
}

const textareaClass = cn(
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
  'placeholder:text-muted-foreground',
  'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
  'disabled:cursor-not-allowed disabled:opacity-50'
)
</script>

<template>
  <div
    :class="cn(
      'mx-auto flex w-full flex-col gap-6 p-4 transition-[max-width] duration-[var(--dur)] ease-[var(--ease)] md:p-6',
      created ? 'max-w-5xl' : 'max-w-2xl'
    )"
  >
    <!-- Page header -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">
        New agent
      </h1>
      <p class="mt-1 max-w-prose text-sm text-muted-foreground">
        Define the goal and script. The Copilot compiles the expected call flow — the baseline every call is measured against — before the agent takes a single call.
      </p>
    </div>

    <div
      :class="cn(
        'grid gap-6',
        created && 'md:grid-cols-2'
      )"
    >
      <!-- Definition form -->
      <SectionCard title="Agent definition">
        <template #actions>
          <Button
            variant="ghost"
            size="sm"
            :disabled="locked"
            @click="useExample"
          >
            <Wand2 class="size-3.5" /> Use example
          </Button>
        </template>

        <form
          class="flex flex-col gap-5"
          novalidate
          @submit.prevent="submit"
        >
          <!-- Name -->
          <div class="flex flex-col gap-1.5">
            <Label for="name">Name</Label>
            <Input
              id="name"
              v-model="form.name"
              placeholder="e.g. Appointment booker"
              :disabled="locked"
              :aria-invalid="submitted && Boolean(nameError)"
              :aria-describedby="submitted && nameError ? 'name-error' : undefined"
            />
            <p
              v-if="submitted && nameError"
              id="name-error"
              class="text-[12px] text-danger"
            >
              {{ nameError }}
            </p>
          </div>

          <!-- Goal -->
          <div class="flex flex-col gap-1.5">
            <Label for="goal">Goal</Label>
            <textarea
              id="goal"
              v-model="form.goal"
              rows="3"
              placeholder="What does a successful call achieve?"
              :disabled="locked"
              :aria-invalid="submitted && Boolean(goalError)"
              :aria-describedby="submitted && goalError ? 'goal-error' : undefined"
              :class="textareaClass"
            />
            <p
              v-if="submitted && goalError"
              id="goal-error"
              class="text-[12px] text-danger"
            >
              {{ goalError }}
            </p>
          </div>

          <!-- Script -->
          <div class="flex flex-col gap-1.5">
            <Label for="script">
              Script <span class="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="script"
              v-model="form.script"
              rows="6"
              placeholder="The steps the agent should follow on a call…"
              :disabled="locked"
              :class="textareaClass"
            />
            <p class="text-[12px] text-muted-foreground">
              A clearer script produces a richer expected flow to measure drift against.
            </p>
          </div>

          <!-- Actions -->
          <div
            v-if="!created"
            class="flex items-center gap-2 pt-1"
          >
            <Button
              type="submit"
              :disabled="submitting || (submitted && !canSubmit)"
            >
              <component
                :is="submitting ? Loader2 : Sparkles"
                :class="['size-4', submitting && 'motion-safe:animate-spin']"
              />
              {{ submitting ? 'Creating…' : 'Create agent' }}
            </Button>
          </div>
          <div
            v-else
            class="flex items-center gap-2 pt-1"
          >
            <Button as-child>
              <NuxtLink :to="`/agents/${created.agent.id}`">
                Open agent <ArrowRight class="size-4" />
              </NuxtLink>
            </Button>
            <Button
              type="button"
              variant="outline"
              @click="reset"
            >
              Create another
            </Button>
          </div>
        </form>
      </SectionCard>

      <!-- Expected flow (revealed after create) -->
      <SectionCard
        v-if="created"
        padding="dense"
      >
        <template #actions />
        <div class="flex flex-col gap-4">
          <div class="flex items-start gap-2">
            <span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2 class="size-4" />
            </span>
            <div class="min-w-0">
              <h2 class="text-[18px] font-semibold leading-tight tracking-tight">
                Expected call flow
              </h2>
              <p class="text-[12px] text-muted-foreground">
                {{ created.flow.nodes.length }} steps · generated by {{ created.flow.provider }}/{{ created.flow.model }}
              </p>
            </div>
          </div>
          <FlowDiagram
            :flow="created.flow"
            :interactive="false"
          />
        </div>
      </SectionCard>
    </div>
  </div>
</template>
