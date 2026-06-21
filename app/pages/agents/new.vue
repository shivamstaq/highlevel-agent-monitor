<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ArrowLeft, ArrowRight, Sparkles, Wand2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { Agent, ExpectedFlow } from '#shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import FlowDiagram from '~/components/FlowDiagram.vue'

const { createAgent } = useApi()

const form = reactive({
  name: '',
  goal: '',
  script: ''
})

const submitting = ref(false)
const created = ref<{ agent: Agent, flow: ExpectedFlow } | null>(null)

const examples = [
  {
    name: 'Solar Lead Qualifier',
    goal: 'Qualify inbound solar leads: confirm homeownership, average monthly electric bill, and roof type, then book a consultation for qualified leads.',
    script: 'Greet warmly and introduce yourself as the solar advisor. Confirm the caller owns their home. Ask for their average monthly electric bill and roof type. If they qualify (homeowner, bill > $80), offer two consultation slots and confirm one. Read back the appointment. Thank them and close.'
  }
]

function useExample() {
  const ex = examples[0]!
  form.name = ex.name
  form.goal = ex.goal
  form.script = ex.script
}

async function submit() {
  if (!form.name.trim() || !form.goal.trim()) {
    toast.error('Name and goal are required')
    return
  }
  submitting.value = true
  try {
    const res = await createAgent({ name: form.name.trim(), goal: form.goal.trim(), script: form.script.trim() })
    created.value = res
    toast.success('Agent created', { description: `Designed a ${res.flow.nodes.length}-step call flow.` })
  } catch {
    toast.error('Could not create the agent')
  } finally {
    submitting.value = false
  }
}

function reset() {
  created.value = null
  form.name = ''
  form.goal = ''
  form.script = ''
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
    <NuxtLink
      to="/"
      class="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft class="size-4" /> Back to overview
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold tracking-tight">
        New Voice AI agent
      </h1>
      <p class="text-sm text-muted-foreground">
        Define the agent's goal and script. The Copilot compiles the expected call flow — the
        design intent every call is measured against — before the agent takes a single call.
      </p>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Form -->
      <Card class="gap-0 py-0">
        <CardHeader class="flex-row items-center justify-between border-b py-4">
          <CardTitle class="text-base">
            Agent definition
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            @click="useExample"
          >
            <Wand2 class="size-3.5" /> Use example
          </Button>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex flex-col gap-1.5">
            <Label for="name">Name</Label>
            <Input
              id="name"
              v-model="form.name"
              placeholder="e.g. Appointment Booker"
              :disabled="submitting || !!created"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="goal">Goal</Label>
            <textarea
              id="goal"
              v-model="form.goal"
              rows="3"
              placeholder="What does a successful call achieve?"
              :disabled="submitting || !!created"
              class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="script">Script <span class="text-muted-foreground">(optional)</span></Label>
            <textarea
              id="script"
              v-model="form.script"
              rows="6"
              placeholder="The steps the agent should follow on a call…"
              :disabled="submitting || !!created"
              class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div
            v-if="!created"
            class="flex items-center gap-2"
          >
            <Button
              :disabled="submitting"
              @click="submit"
            >
              <Sparkles :class="['size-4', submitting && 'animate-pulse']" />
              {{ submitting ? 'Designing call flow…' : 'Create & design flow' }}
            </Button>
          </div>
          <div
            v-else
            class="flex items-center gap-2"
          >
            <Button as-child>
              <NuxtLink :to="`/agents/${created.agent.id}`">
                Open agent <ArrowRight class="size-4" />
              </NuxtLink>
            </Button>
            <Button
              variant="outline"
              @click="reset"
            >
              Create another
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Generated flow -->
      <Card class="gap-0 py-0">
        <CardHeader class="border-b py-4">
          <CardTitle class="text-base">
            Expected call flow
          </CardTitle>
          <p class="text-xs text-muted-foreground">
            {{ created ? `${created.flow.nodes.length} steps · generated by ${created.flow.provider}/${created.flow.model}` : 'Generated when you create the agent' }}
          </p>
        </CardHeader>
        <CardContent class="p-4">
          <FlowDiagram
            v-if="created"
            :flow="created.flow"
          />
          <div
            v-else
            class="flex flex-col items-center justify-center gap-3 py-20 text-center"
          >
            <div class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles class="size-6" />
            </div>
            <p class="max-w-xs text-sm text-muted-foreground">
              The Copilot will map the greeting, qualification, decision branches, and close as a
              decision graph — your observability baseline.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
