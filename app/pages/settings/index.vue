<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Info,
  KeyRound,
  Link2,
  Link2Off,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCw,
  Save,
  Sparkles,
  User
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AppContext, LlmProviderId, LlmSettings, SaveLlmSettings } from '~/composables/useApi'
import SectionCard from '~/components/SectionCard.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/ui/select'
import { useGhlBridge } from '~/composables/useGhlBridge'
import { useBreadcrumb } from '~/composables/useBreadcrumb'

/**
 * /settings — Settings & integrations (W07).
 *
 * For an embedded marketplace app the table-stakes questions are: which location
 * am I scoped to, am I connected, and which model scores my calls. This screen
 * answers all three, plus hosts the manual "Sync calls from HighLevel" trigger
 * and the demo-data controls moved off the Overview header.
 *
 * GHL connection is resolved live via useGhlBridge (the iframe handshake) — the
 * composable was previously dead code; this is where it's actually invoked.
 */
const { syncCalls, getContext, getSettings, saveSettings } = useApi()
const { locationId, userId, email, ready } = useGhlBridge()
const { setBreadcrumb } = useBreadcrumb()

useHead({ title: 'Settings' })

watchEffect(() => {
  setBreadcrumb([{ label: 'Settings' }])
})

/* ----------------------------------------------------------------------------
 * Resolved context (location + user). The bridge resolves locationId/userId/
 * email from the iframe handshake; we enrich with the full /api/context payload
 * (userName / role) once a locationId is known.
 * ------------------------------------------------------------------------- */
const context = ref<AppContext | null>(null)

watch(
  [ready, locationId],
  async ([isReady, loc]) => {
    if (!isReady || !loc || context.value) return
    try {
      context.value = await getContext({ locationId: loc })
    } catch {
      // Best-effort enrichment; the bridge values still stand below.
    }
  },
  { immediate: true }
)

const connected = computed(() => Boolean(locationId.value))

/* ----------------------------------------------------------------------------
 * Resolve the "Checking" state — never leave an unlabeled spinner forever (P23).
 *
 * `ready` from the bridge flips true once the iframe handshake answers OR its
 * internal fallback fires. We add a SHORTER page-level safety timeout so the
 * chip resolves to a clear, actionable state even if the parent never replies
 * (the common standalone / mis-embedded case). Optimistic: the instant a
 * locationId appears (URL param or handshake), we treat the session as resolved
 * and stop showing the spinner — a known location IS a connection.
 *
 * `resolved` = the bridge reported in, OR we already have a location, OR our own
 * timeout elapsed. Until then we show a LABELED "Resolving…" state, not a bare
 * spinner. "Retry connection" re-posts the handshake without a full reload.
 */
const RESOLVE_TIMEOUT_MS = 1200
const timedOut = ref(false)
let resolveTimer: ReturnType<typeof setTimeout> | null = null

function startResolveTimer() {
  timedOut.value = false
  if (resolveTimer) clearTimeout(resolveTimer)
  resolveTimer = setTimeout(() => {
    timedOut.value = true
  }, RESOLVE_TIMEOUT_MS)
}

onMounted(startResolveTimer)
onBeforeUnmount(() => {
  if (resolveTimer) clearTimeout(resolveTimer)
})

/** True once we can stop showing the spinner (bridge in, location known, or timed out). */
const resolved = computed(() => ready.value || connected.value || timedOut.value)

/** Connection chip state machine: one of resolving | connected | disconnected. */
const connectionState = computed<'resolving' | 'connected' | 'disconnected'>(() => {
  if (connected.value) return 'connected'
  if (!resolved.value) return 'resolving'
  return 'disconnected'
})

/**
 * Retry the handshake. We re-post REQUEST_USER_DATA to the parent (if embedded)
 * and restart our own resolve window, so a transient miss can recover without a
 * full page reload. Optimistic + bounded — the chip returns to "Resolving…" and
 * then settles again.
 */
const retrying = ref(false)
function retryConnection() {
  retrying.value = true
  startResolveTimer()
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
  }
  setTimeout(() => {
    retrying.value = false
  }, RESOLVE_TIMEOUT_MS)
}

const resolvedUserName = computed(() => context.value?.userName)
const resolvedEmail = computed(() => context.value?.email ?? email.value ?? undefined)
const resolvedUserId = computed(() => context.value?.userId ?? userId.value ?? undefined)
const resolvedRole = computed(() => context.value?.role)

/* ----------------------------------------------------------------------------
 * Analysis engine — provider, per-role models, and write-only API keys.
 *
 * The effective config is resolved server-side (stored OVER runtimeConfig OVER
 * cost-low defaults) and surfaced via GET /api/settings. API keys NEVER reach
 * the browser — only their presence (anthropicKeySet / openaiKeySet). Editing a
 * key field and saving sets/replaces it; leaving it blank preserves the stored
 * key (write-only). The active provider/model is shown so the operator can
 * verify exactly what scores their calls.
 * ------------------------------------------------------------------------- */

/** Model menus per provider (from docs/model-plan.md — the keys-enabled set). */
const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — default reasoner' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 — upgrade (pricier)' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — default labeler' }
] as const
const OPENAI_MODELS = [
  { value: 'gpt-5.5', label: 'GPT-5.5 — reasoner' },
  { value: 'o3-mini', label: 'o3-mini — cheaper reasoner' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini — labeler' }
] as const

const PROVIDER_OPTIONS: { value: LlmProviderId, label: string }[] = [
  { value: 'mock', label: 'Mock — deterministic, zero cost' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' },
  { value: 'ollama', label: 'Ollama — local' }
]

/** Live engine config from the server (presence booleans, never key values). */
const engine = ref<LlmSettings | null>(null)
const engineLoading = ref(true)

/** Editable form state (seeded from the server config on load). */
const formProvider = ref<LlmProviderId>('mock')
const formReasoner = ref('claude-sonnet-4-6')
const formLabeler = ref('claude-haiku-4-5')
/** Key inputs are blank by default — typing a value sets/replaces; blank preserves. */
const formAnthropicKey = ref('')
const formOpenaiKey = ref('')

/** Models shown in the per-role selects depend on the chosen provider. */
const reasonerModelOptions = computed(() => {
  if (formProvider.value === 'openai') return [...OPENAI_MODELS]
  return [...ANTHROPIC_MODELS]
})
const labelerModelOptions = reasonerModelOptions

/** Whether the selected provider needs its own API key (and which is set). */
const needsAnthropicKey = computed(() => formProvider.value === 'anthropic')
const needsOpenaiKey = computed(() => formProvider.value === 'openai')

const anthropicKeySet = computed(() => Boolean(engine.value?.anthropicKeySet))
const openaiKeySet = computed(() => Boolean(engine.value?.openaiKeySet))

async function loadEngine() {
  engineLoading.value = true
  try {
    const cfg = await getSettings()
    engine.value = cfg
    formProvider.value = cfg.provider
    formReasoner.value = cfg.reasonerModel
    formLabeler.value = cfg.labelerModel
  } catch {
    // Best-effort: leave the cost-low defaults in the form if the load fails.
  } finally {
    engineLoading.value = false
  }
}

onMounted(loadEngine)

const savingEngine = ref(false)
async function saveEngine() {
  savingEngine.value = true
  try {
    const body: SaveLlmSettings = {
      provider: formProvider.value,
      reasonerModel: formReasoner.value,
      labelerModel: formLabeler.value
    }
    // Keys are write-only: only send when the operator typed something.
    if (formAnthropicKey.value.trim()) body.anthropicKey = formAnthropicKey.value.trim()
    if (formOpenaiKey.value.trim()) body.openaiKey = formOpenaiKey.value.trim()

    const cfg = await saveSettings(body)
    engine.value = cfg
    formProvider.value = cfg.provider
    formReasoner.value = cfg.reasonerModel
    formLabeler.value = cfg.labelerModel
    // Clear the key inputs after a successful save — they're never echoed back.
    formAnthropicKey.value = ''
    formOpenaiKey.value = ''
    toast.success('Analysis engine saved', {
      description: `Now using ${PROVIDER_OPTIONS.find(p => p.value === cfg.provider)?.label ?? cfg.provider}.`
    })
  } catch {
    toast.error('Couldn\'t save the analysis engine', {
      description: 'The settings request failed. Check your connection and try again.'
    })
  } finally {
    savingEngine.value = false
  }
}

/** Human label for the active provider, shown in the "active" line. */
const activeProviderLabel = computed(() =>
  PROVIDER_OPTIONS.find(p => p.value === engine.value?.provider)?.label
  ?? engine.value?.provider
  ?? '—'
)

/* ----------------------------------------------------------------------------
 * Analysis-status honesty (USER MANDATE: an operator must see at a glance whether
 * REAL Claude analysis is on, vs the zero-cost deterministic 'mock' floor, vs a
 * cloud provider that's selected but un-keyed and will silently fall back).
 *
 * Derived purely from the presence booleans GET /api/settings already returns —
 * no key value ever reaches the browser:
 *   · 'live'         — a cloud provider is selected AND its key is set. Real LLM
 *                       analysis scores calls right now.
 *   · 'mock'         — the deterministic floor: zero cost, no real LLM.
 *   · 'missing-key'  — a cloud provider is selected but its key is NOT set, so the
 *                       pipeline falls back to deterministic output (flagged on
 *                       each analyzed call as "Deterministic fallback").
 * ------------------------------------------------------------------------- */
type EngineStatus = 'live' | 'mock' | 'missing-key' | 'unknown'
const engineStatus = computed<EngineStatus>(() => {
  const e = engine.value
  if (!e) return 'unknown'
  if (e.provider === 'mock') return 'mock'
  if (e.provider === 'ollama') return 'live' // local, no API key required
  if (e.provider === 'anthropic') return e.anthropicKeySet ? 'live' : 'missing-key'
  if (e.provider === 'openai') return e.openaiKeySet ? 'live' : 'missing-key'
  return 'unknown'
})

/* ----------------------------------------------------------------------------
 * Sync calls from HighLevel
 * ------------------------------------------------------------------------- */
const syncing = ref(false)
async function runSync() {
  syncing.value = true
  try {
    const res = await syncCalls(locationId.value ? { locationId: locationId.value } : undefined)
    if (res.errors?.length) {
      const reason = res.errors[0] ?? 'Sync did not complete.'
      if (res.ingested > 0) {
        toast.warning(`Synced ${res.ingested} call${res.ingested === 1 ? '' : 's'} with issues`, {
          description: reason
        })
      } else {
        toast.error('Couldn\'t sync calls', {
          description: `${reason} Check your HighLevel connection in this location, then try again.`
        })
      }
    } else {
      toast.success(
        res.ingested > 0
          ? `Synced ${res.ingested} call${res.ingested === 1 ? '' : 's'} from HighLevel`
          : 'No new calls to sync',
        {
          description: res.ingested > 0
            ? 'New calls are ready to analyze in the Calls inbox.'
            : 'Your call log is already up to date.'
        }
      )
    }
  } catch {
    toast.error('Couldn\'t reach HighLevel', {
      description: 'The sync request failed. Check your connection and try again.'
    })
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
    <!-- Page header -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">
        Settings
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">
        Your HighLevel connection, the model that scores your calls, and tools to sync data.
      </p>
    </div>

    <!-- HighLevel connection -->
    <SectionCard
      title="HighLevel connection"
      description="The location this app is scoped to, resolved from the embedded session."
    >
      <template #actions>
        <span
          v-if="connectionState === 'resolving'"
          class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
        >
          <Loader2 class="size-3.5 motion-safe:animate-spin" />
          Resolving session…
        </span>
        <span
          v-else-if="connectionState === 'connected'"
          class="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[12px] font-medium text-success"
        >
          <Link2 class="size-3.5" />
          Connected
        </span>
        <span
          v-else
          class="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning-foreground"
        >
          <Link2Off class="size-3.5" />
          Not connected
        </span>
      </template>

      <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <dt class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <MapPin class="size-3.5" /> Location ID
          </dt>
          <dd
            v-if="locationId"
            class="break-all font-mono text-sm"
          >
            {{ locationId }}
          </dd>
          <dd
            v-else-if="resolved"
            class="text-sm text-muted-foreground"
          >
            Not resolved
          </dd>
          <dd
            v-else
            class="h-5 w-40 motion-safe:animate-pulse rounded bg-muted"
            aria-hidden="true"
          />
        </div>

        <div class="flex flex-col gap-1">
          <dt class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <User class="size-3.5" /> Signed-in user
          </dt>
          <dd
            v-if="resolvedUserName || resolvedEmail || resolvedUserId"
            class="text-sm"
          >
            <span class="font-medium">{{ resolvedUserName ?? resolvedEmail ?? resolvedUserId }}</span>
            <span
              v-if="resolvedRole"
              class="ml-1.5 text-muted-foreground"
            >· {{ resolvedRole }}</span>
            <p
              v-if="resolvedUserName && resolvedEmail"
              class="text-[12px] text-muted-foreground"
            >
              {{ resolvedEmail }}
            </p>
          </dd>
          <dd
            v-else-if="resolved"
            class="text-sm text-muted-foreground"
          >
            Not resolved
          </dd>
          <dd
            v-else
            class="h-5 w-32 motion-safe:animate-pulse rounded bg-muted"
            aria-hidden="true"
          />
        </div>
      </dl>

      <!-- Resolving: labeled progress, never a bare unexplained spinner (P23). -->
      <p
        v-if="connectionState === 'resolving'"
        class="mt-4 flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground"
      >
        <Loader2 class="size-3.5 shrink-0 motion-safe:animate-spin" />
        Resolving your HighLevel session…
      </p>

      <!-- Disconnected: a clear, actionable resolution — not an endless spinner. -->
      <div
        v-else-if="connectionState === 'disconnected'"
        class="mt-4 flex flex-col gap-3 rounded-md bg-warning-soft px-3 py-3"
      >
        <p class="flex items-start gap-2 text-[12px] leading-relaxed text-warning-foreground">
          <Link2Off class="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span class="font-medium">Not connected — open inside HighLevel.</span>
            Launch this app from your HighLevel location so it can resolve which location and user it's scoped to. Running it standalone leaves the location unscoped.
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          class="self-start"
          :disabled="retrying"
          @click="retryConnection"
        >
          <component
            :is="retrying ? Loader2 : RotateCw"
            :class="['size-4', retrying && 'motion-safe:animate-spin']"
          />
          {{ retrying ? 'Retrying…' : 'Retry connection' }}
        </Button>
      </div>
    </SectionCard>

    <!-- Analysis engine — provider & keys -->
    <SectionCard
      title="Analysis engine — provider & keys"
      description="Which provider and models score your transcripts. Keys are stored server-side and never returned to the browser."
    >
      <template #actions>
        <span
          v-if="engineLoading"
          class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
        >
          <Loader2 class="size-3.5 motion-safe:animate-spin" />
          Loading…
        </span>
        <span
          v-else
          class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary"
        >
          <Cpu class="size-3.5" />
          {{ activeProviderLabel }}
        </span>
      </template>

      <!-- Active, server-resolved config (honesty: what scores calls right now). -->
      <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <div class="flex flex-col gap-1">
          <dt class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <Cpu class="size-3.5" /> Active provider
          </dt>
          <dd class="text-sm font-medium capitalize">
            {{ engine?.provider ?? '—' }}
          </dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <CheckCircle2 class="size-3.5" /> Reasoner model
          </dt>
          <dd class="break-all font-mono text-sm">
            {{ engine?.reasonerModel ?? '—' }}
          </dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <CheckCircle2 class="size-3.5" /> Labeler model
          </dt>
          <dd class="break-all font-mono text-sm">
            {{ engine?.labelerModel ?? '—' }}
          </dd>
        </div>
      </dl>

      <!-- Analysis-status banner — at-a-glance honesty about whether REAL LLM
           analysis is on, the zero-cost mock floor is active, or a cloud provider
           is selected but un-keyed (and will fall back). Derived from the presence
           booleans only; no key value reaches the browser. -->
      <div
        v-if="!engineLoading"
        :class="[
          'mt-5 flex items-start gap-2.5 rounded-md px-3 py-2.5 text-[13px] leading-relaxed',
          engineStatus === 'live' && 'bg-success-soft text-success',
          engineStatus === 'missing-key' && 'bg-warning-soft text-warning-foreground',
          (engineStatus === 'mock' || engineStatus === 'unknown') && 'bg-muted/60 text-muted-foreground'
        ]"
      >
        <component
          :is="engineStatus === 'live' ? Sparkles : engineStatus === 'missing-key' ? AlertTriangle : Info"
          class="mt-0.5 size-4 shrink-0"
        />
        <span v-if="engineStatus === 'live'">
          <span class="font-semibold">Live analysis is on.</span>
          Calls are scored by {{ activeProviderLabel }} ({{ engine?.reasonerModel }}) — real LLM output, not a placeholder.
        </span>
        <span v-else-if="engineStatus === 'missing-key'">
          <span class="font-semibold">{{ activeProviderLabel }} is selected but its API key isn't set.</span>
          Until you add a key below, analysis falls back to deterministic output — every analyzed call is flagged
          <span class="font-medium">"Deterministic fallback — not Claude-generated."</span>
        </span>
        <span v-else-if="engineStatus === 'mock'">
          <span class="font-semibold">Mock engine — zero cost, deterministic.</span>
          No real LLM is scoring calls. Select a cloud provider and add its key below to turn on live analysis.
        </span>
        <span v-else>
          Resolving the active analysis engine…
        </span>
      </div>

      <div class="mt-6 border-t pt-6">
        <div class="grid gap-5 sm:grid-cols-2">
          <!-- Provider -->
          <div class="flex flex-col gap-1.5">
            <Label for="engine-provider">Provider</Label>
            <Select
              v-model="formProvider"
              :disabled="engineLoading || savingEngine"
            >
              <SelectTrigger
                id="engine-provider"
                class="w-full"
                aria-label="Analysis provider"
              >
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in PROVIDER_OPTIONS"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[12px] leading-relaxed text-muted-foreground">
              Mock stays free and deterministic until a key + cloud provider is set.
            </p>
          </div>

          <!-- spacer to keep the model selects on their own row on sm+ -->
          <div class="hidden sm:block" />

          <!-- Reasoner model -->
          <div class="flex flex-col gap-1.5">
            <Label for="engine-reasoner">Reasoner model</Label>
            <Select
              v-model="formReasoner"
              :disabled="engineLoading || savingEngine"
            >
              <SelectTrigger
                id="engine-reasoner"
                class="w-full"
                aria-label="Reasoner model"
              >
                <SelectValue placeholder="Choose a reasoner model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in reasonerModelOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[12px] leading-relaxed text-muted-foreground">
              Stages, success criteria, and the per-call analysis.
            </p>
          </div>

          <!-- Labeler model -->
          <div class="flex flex-col gap-1.5">
            <Label for="engine-labeler">Labeler model</Label>
            <Select
              v-model="formLabeler"
              :disabled="engineLoading || savingEngine"
            >
              <SelectTrigger
                id="engine-labeler"
                class="w-full"
                aria-label="Labeler model"
              >
                <SelectValue placeholder="Choose a labeler model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in labelerModelOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[12px] leading-relaxed text-muted-foreground">
              High-volume per-turn labeling — kept cheap and fast.
            </p>
          </div>
        </div>

        <!-- API keys (write-only) -->
        <div class="mt-6 grid gap-5 sm:grid-cols-2">
          <!-- Anthropic key -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between gap-2">
              <Label for="engine-anthropic-key">Anthropic API key</Label>
              <span
                :class="[
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  anthropicKeySet ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'
                ]"
              >
                <Check
                  v-if="anthropicKeySet"
                  class="size-3"
                />
                {{ anthropicKeySet ? 'Set' : 'Not set' }}
              </span>
            </div>
            <div class="relative">
              <KeyRound class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="engine-anthropic-key"
                v-model="formAnthropicKey"
                type="password"
                autocomplete="off"
                class="pl-8"
                :placeholder="anthropicKeySet ? 'Stored — type to replace' : 'sk-ant-…'"
                :disabled="engineLoading || savingEngine"
              />
            </div>
            <p
              v-if="needsAnthropicKey && !anthropicKeySet"
              class="text-[12px] leading-relaxed text-warning-foreground"
            >
              Anthropic is selected but no key is set — analysis falls back to mock until you add one.
            </p>
          </div>

          <!-- OpenAI key -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between gap-2">
              <Label for="engine-openai-key">OpenAI API key</Label>
              <span
                :class="[
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  openaiKeySet ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'
                ]"
              >
                <Check
                  v-if="openaiKeySet"
                  class="size-3"
                />
                {{ openaiKeySet ? 'Set' : 'Not set' }}
              </span>
            </div>
            <div class="relative">
              <KeyRound class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="engine-openai-key"
                v-model="formOpenaiKey"
                type="password"
                autocomplete="off"
                class="pl-8"
                :placeholder="openaiKeySet ? 'Stored — type to replace' : 'sk-…'"
                :disabled="engineLoading || savingEngine"
              />
            </div>
            <p
              v-if="needsOpenaiKey && !openaiKeySet"
              class="text-[12px] leading-relaxed text-warning-foreground"
            >
              OpenAI is selected but no key is set — analysis falls back to mock until you add one.
            </p>
          </div>
        </div>

        <div class="mt-6 flex items-center justify-between gap-4">
          <p class="text-[12px] leading-relaxed text-muted-foreground">
            Keys are write-only — saved server-side and never returned to the browser. Leave a key blank to keep the stored one.
          </p>
          <Button
            class="shrink-0"
            :disabled="engineLoading || savingEngine"
            @click="saveEngine"
          >
            <component
              :is="savingEngine ? Loader2 : Save"
              :class="['size-4', savingEngine && 'motion-safe:animate-spin']"
            />
            {{ savingEngine ? 'Saving…' : 'Save engine' }}
          </Button>
        </div>
      </div>
    </SectionCard>

    <!-- Sync calls -->
    <SectionCard
      title="Sync calls from HighLevel"
      description="Pull the latest Voice AI call logs and transcripts into your inbox."
    >
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p class="max-w-md text-sm text-muted-foreground">
          Fetches new calls for this location so they're ready to analyze. Existing calls aren't duplicated.
        </p>
        <Button
          class="shrink-0"
          :disabled="syncing"
          @click="runSync"
        >
          <component
            :is="syncing ? Loader2 : RefreshCw"
            :class="['size-4', syncing && 'motion-safe:animate-spin']"
          />
          {{ syncing ? 'Syncing…' : 'Sync calls' }}
        </Button>
      </div>
    </SectionCard>
  </div>
</template>
