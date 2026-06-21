<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import {
  CheckCircle2,
  Cpu,
  Database,
  Link2,
  Link2Off,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCw,
  Sparkles,
  User
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AppContext } from '~/composables/useApi'
import SectionCard from '~/components/SectionCard.vue'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
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
const { syncCalls, seed, getContext } = useApi()
const { locationId, userId, email, ready } = useGhlBridge()
const { setBreadcrumb } = useBreadcrumb()
const runtime = useRuntimeConfig()

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
 * LLM provider / model — resolved server-side, surfaced read-only. Only the
 * public app name is exposed to the client; provider/model selection lives in
 * server runtimeConfig, so we show what the operator can verify and label the
 * analysis as server-resolved rather than inventing a model string.
 * ------------------------------------------------------------------------- */
const appName = computed(() => runtime.public.appName as string)

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

/* ----------------------------------------------------------------------------
 * Demo data (moved off the Overview header)
 * ------------------------------------------------------------------------- */
const seeding = ref(false)
async function loadDemo() {
  seeding.value = true
  try {
    const res = await seed()
    toast.success('Demo data loaded', {
      description: `${res.agents} agents and ${res.calls} calls are ready to explore.`
    })
  } catch {
    toast.error('Couldn\'t load demo data', {
      description: 'The seed request failed. Try again in a moment.'
    })
  } finally {
    seeding.value = false
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
        Your HighLevel connection, the model that scores your calls, and tools to sync or seed data.
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

    <!-- Analysis model -->
    <SectionCard
      title="Analysis model"
      description="The model that scores transcripts and writes findings runs server-side."
    >
      <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <dt class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <Cpu class="size-3.5" /> Application
          </dt>
          <dd class="text-sm font-medium">
            {{ appName }}
          </dd>
        </div>
        <div class="flex flex-col gap-1">
          <dt class="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <CheckCircle2 class="size-3.5" /> Scoring model
          </dt>
          <dd class="text-sm font-medium">
            Managed model — set by your admin
          </dd>
        </div>
      </dl>
      <p class="mt-4 text-[12px] leading-relaxed text-muted-foreground">
        The provider and model that score your calls are configured server-side so API keys never reach the browser. Ask your workspace admin to change which model scores calls.
      </p>
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

    <!-- Demo data -->
    <SectionCard
      title="Demo data"
      description="Seed sample agents, calls, and analyses to explore the app."
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="max-w-md text-sm text-muted-foreground">
            Loads a curated dataset of Voice AI agents with scored transcripts and findings. Reloading replaces the current demo data.
          </p>
          <Button
            variant="outline"
            class="shrink-0"
            :disabled="seeding"
            @click="loadDemo"
          >
            <component
              :is="seeding ? Loader2 : Sparkles"
              :class="['size-4', seeding && 'motion-safe:animate-spin']"
            />
            {{ seeding ? 'Loading demo data…' : 'Load demo data' }}
          </Button>
        </div>
        <Separator />
        <p class="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
          <Database class="mt-0.5 size-3.5 shrink-0" />
          Demo data lives alongside synced calls. Use it to try the dashboard before connecting a live location.
        </p>
      </div>
    </SectionCard>
  </div>
</template>
