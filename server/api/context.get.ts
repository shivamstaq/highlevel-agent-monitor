/**
 * GET /api/context — decode the GHL Custom-Page signed user context.
 *
 * The iframe-embedded app obtains an `encryptedData` blob from the parent GHL
 * window (via postMessage) and forwards it here to recover the location/user
 * identity server-side using the app's shared secret. Best-effort: on any
 * failure we still return whatever `locationId` was supplied as a query param
 * so the dashboard can scope itself.
 *
 * NOTE: the exact GHL context scheme should be verified in-sandbox — see
 * server/utils/ghlContext.ts.
 */
import { decryptUserContext } from '../utils/ghlContext'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const query = getQuery(event)
  const encryptedData = typeof query.encryptedData === 'string' ? query.encryptedData : ''
  const fallbackLocationId = typeof query.locationId === 'string' ? query.locationId : undefined

  if (encryptedData && config.ghlSharedSecret) {
    const ctx = decryptUserContext(encryptedData, config.ghlSharedSecret)
    if (ctx) {
      return {
        locationId: ctx.locationId ?? ctx.companyId ?? fallbackLocationId,
        userId: ctx.userId,
        email: ctx.email,
        userName: ctx.userName,
        role: ctx.role,
        type: ctx.type
      }
    }
  }

  // Could not decrypt (or nothing to decrypt) — fall back to the raw locationId.
  return { locationId: fallbackLocationId }
})
