/**
 * useGhlBridge — establishes the GoHighLevel Custom-Page iframe handshake.
 *
 * Resolution order for the active location:
 *   1. `?locationId=` in the iframe URL (GHL appends this to embedded pages).
 *   2. The postMessage handshake: we post `{ message: 'REQUEST_USER_DATA' }` to
 *      `window.parent`; GHL replies with `{ message: 'REQUEST_USER_DATA_RESPONSE',
 *      payload: <encryptedData> }`. We forward that blob to `/api/context` to
 *      recover the locationId/user identity server-side.
 *
 * SSR-safe: all `window` access is guarded and deferred to `onMounted`.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'

export interface GhlBridgeState {
  locationId: Ref<string | null>
  userId: Ref<string | null>
  email: Ref<string | null>
  ready: Ref<boolean>
}

export function useGhlBridge(): GhlBridgeState {
  const locationId = ref<string | null>(null)
  const userId = ref<string | null>(null)
  const email = ref<string | null>(null)
  const ready = ref(false)

  let messageHandler: ((e: MessageEvent) => void) | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  async function resolveContext(encryptedData?: string) {
    try {
      const params = new URLSearchParams()
      if (encryptedData) params.set('encryptedData', encryptedData)
      if (locationId.value) params.set('locationId', locationId.value)
      const res = await $fetch<{ locationId?: string, userId?: string, email?: string }>(
        `/api/context?${params.toString()}`
      )
      if (res?.locationId) locationId.value = res.locationId
      if (res?.userId) userId.value = res.userId
      if (res?.email) email.value = res.email
    } catch {
      // Context decode is best-effort; the URL locationId (if any) still stands.
    } finally {
      ready.value = true
    }
  }

  onMounted(() => {
    if (typeof window === 'undefined') {
      ready.value = true
      return
    }

    // 1. URL query param wins as the immediate source of truth.
    const urlLocation = new URLSearchParams(window.location.search).get('locationId')
    if (urlLocation) locationId.value = urlLocation

    const inIframe = window.parent && window.parent !== window
    if (!inIframe) {
      // Standalone (dev / direct) — resolve from URL only.
      void resolveContext()
      return
    }

    // 2. Listen for the GHL parent's user-data response.
    messageHandler = (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data !== 'object') return
      if (data.message === 'REQUEST_USER_DATA_RESPONSE') {
        if (timeoutId) clearTimeout(timeoutId)
        const encrypted = typeof data.payload === 'string' ? data.payload : undefined
        void resolveContext(encrypted)
      }
    }
    window.addEventListener('message', messageHandler)

    // 3. Ask the parent for the signed user context.
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')

    // Fallback: if the parent never answers, proceed with the URL locationId.
    timeoutId = setTimeout(() => {
      if (!ready.value) void resolveContext()
    }, 3000)
  })

  onBeforeUnmount(() => {
    if (messageHandler && typeof window !== 'undefined') {
      window.removeEventListener('message', messageHandler)
    }
    if (timeoutId) clearTimeout(timeoutId)
  })

  return { locationId, userId, email, ready }
}
