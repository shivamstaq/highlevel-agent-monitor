/**
 * useAnalysis — reactive driver for one call's analysis run.
 *
 * Owns the trigger + live polling + single-flight handling so the call page just
 * renders `status`/`running`/`steps`. While a run is in flight (started here OR by
 * another tab/user) it polls `GET /api/analyze/:id/status` and surfaces the
 * step-by-step progress the server writes. A 409 from the trigger means someone
 * else already owns the run — we simply attach to it by polling. On completion the
 * `onComplete` hook fires so the page can refresh the call payload.
 */
import { computed, onScopeDispose, ref, unref, watch, type MaybeRef } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { AnalysisStatus } from '#shared/types'
import { useApi } from '~/composables/useApi'

interface UseAnalysisOptions {
  /** Fired when a run reaches the `done` state (refresh the call payload here). */
  onComplete?: (status: AnalysisStatus) => void
}

const POLL_MS = 1200

export function useAnalysis(callId: MaybeRef<string>, opts: UseAnalysisOptions = {}) {
  const { analyze, analyzeStatus } = useApi()

  const status = ref<AnalysisStatus | null>(null)
  /** True only while THIS composable awaits the trigger POST (drives the button). */
  const triggering = ref(false)

  const running = computed(() => status.value?.state === 'running')
  const steps = computed(() => status.value?.steps ?? [])
  const errorMessage = computed(() => (status.value?.state === 'error' ? status.value.error : undefined))

  let lastDoneNotified: string | null = null

  async function poll() {
    try {
      const s = await analyzeStatus(unref(callId))
      if (!s) {
        // No status row yet. If a trigger is in flight, the server is about to
        // create it — KEEP the optimistic running state and keep polling. Only a
        // genuine "no run" (not triggering) clears + stops the interval.
        if (!triggering.value) {
          status.value = null
          pause()
        }
        return
      }
      status.value = s
      if (s.state !== 'running') {
        pause()
        if (s.state === 'done' && lastDoneNotified !== s.updatedAt) {
          lastDoneNotified = s.updatedAt
          opts.onComplete?.(s)
        }
      }
    } catch {
      // Transient network hiccup — keep the interval alive and retry next tick.
    }
  }

  const { pause, resume, isActive } = useIntervalFn(poll, POLL_MS, { immediate: false })

  /** Load any existing status once (e.g. a run already in flight on page open). */
  async function syncInitial() {
    try {
      const s = await analyzeStatus(unref(callId))
      status.value = s
      if (s?.state === 'running') resume()
    } catch {
      // ignore — no status yet
    }
  }

  /** Trigger (or attach to) an analysis run for this call. */
  async function start(force = true) {
    if (triggering.value) return
    if (running.value) {
      if (!isActive.value) resume()
      return
    }
    triggering.value = true
    // Optimistic: flip the UI into "running" instantly; the first poll fills steps.
    const nowIso = new Date().toISOString()
    status.value = { callId: unref(callId), state: 'running', steps: [], startedAt: nowIso, updatedAt: nowIso }
    resume()
    void poll()
    try {
      await analyze(unref(callId), force)
      await poll() // pull the final done status + fire onComplete
    } catch (err: unknown) {
      const code = (err as { statusCode?: number, response?: { status?: number } })
      if (code?.statusCode === 409 || code?.response?.status === 409) {
        // Another run already owns this call — attach by polling its progress.
        if (!isActive.value) resume()
        await poll()
      } else {
        pause()
        const message = (err as { statusMessage?: string, message?: string })?.statusMessage
          ?? (err as { message?: string })?.message
          ?? 'Analysis failed.'
        status.value = {
          callId: unref(callId),
          state: 'error',
          steps: status.value?.steps ?? [],
          startedAt: status.value?.startedAt ?? nowIso,
          updatedAt: new Date().toISOString(),
          error: message
        }
      }
    } finally {
      triggering.value = false
    }
  }

  // Re-sync if the call id changes (route reuse).
  watch(() => unref(callId), () => {
    pause()
    status.value = null
    lastDoneNotified = null
    void syncInitial()
  })

  onScopeDispose(() => pause())

  return { status, running, triggering, steps, errorMessage, start, syncInitial }
}
