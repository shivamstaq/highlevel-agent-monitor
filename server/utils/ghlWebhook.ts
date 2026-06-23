/**
 * GoHighLevel webhook signature verification (public-key, FAIL-CLOSED).
 *
 * GHL signs its marketplace webhooks with an ASYMMETRIC private key; the
 * receiver verifies with GHL's PUBLISHED public key. There are two schemes:
 *
 *   - CURRENT  `X-GHL-Signature` = Ed25519 signature over the RAW request body,
 *              base64-encoded. Verified with GHL's Ed25519 public key.
 *   - LEGACY   `X-WH-Signature`  = RSA-SHA256 signature over the RAW body,
 *              base64-encoded. Verified with GHL's RSA public key.
 *              Deprecated by GHL — removed 2026-07-01. Kept here (with a logged
 *              deprecation notice) until then.
 *
 * The previous handler computed HMAC-SHA256(rawBody, sharedSecret), which can
 * NEVER match a genuine GHL marketplace webhook (GHL does not HMAC), so it
 * silently dropped every real push. This module replaces that with correct
 * public-key verification.
 *
 * Runtime: Cloudflare Workers (workerd) with `nodejs_compat` ON. node:crypto's
 * `verify(null, data, key, sig)` (Ed25519) and `verify('RSA-SHA256', …)` are
 * provided by the compat layer. Both also work on a plain Node host. If a
 * primitive were unavailable we FAIL CLOSED (treat as invalid), never open.
 *
 * Sources (docs/ghl-integration.md §3 + the GHL Webhook Integration Guide):
 *   https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/index.html
 *   https://ideas.gohighlevel.com/changelog/app-marketplace-security-update-webhook-authentication
 */
import { verify as cryptoVerify, createPublicKey, type KeyObject } from 'node:crypto'

/**
 * GHL's PUBLISHED Ed25519 webhook public key (current `X-GHL-Signature`
 * scheme). This is a PUBLIC key — safe to ship in source — and is the default
 * when no env override is provided. Override via NUXT_GHL_WEBHOOK_ED25519_PUBKEY
 * (e.g. if GHL rotates it) without a redeploy.
 */
export const GHL_DEFAULT_ED25519_PUBKEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`

export interface GhlWebhookKeys {
  /** Ed25519 public key PEM (current scheme). */
  ed25519PubKeyPem: string
  /** RSA public key PEM (legacy scheme, optional). */
  rsaPubKeyPem: string
}

export type VerifyOutcome =
  | { ok: true, scheme: 'ed25519' | 'rsa-legacy' }
  | { ok: false, reason: 'no-signature' | 'no-key' | 'invalid-signature' | 'verify-error' }

/** Normalize a PEM that may arrive from env with literal "\n" sequences. */
function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem
}

/** Parse a PEM public key into a KeyObject, or null on any failure (fail-closed). */
function loadPublicKey(pem: string): KeyObject | null {
  const trimmed = pem?.trim()
  if (!trimmed) return null
  try {
    return createPublicKey(normalizePem(trimmed))
  } catch {
    return null
  }
}

/**
 * Verify a GHL webhook over the EXACT raw body bytes. Fail-closed: returns
 * `{ ok: false, … }` for any missing/invalid signature or key, never throwing.
 *
 * @param rawBody   the exact bytes GHL signed (read via readRawBody, not the
 *                  re-serialized JSON — re-serialization would change bytes).
 * @param headers   accessor for request headers (case-insensitive name).
 * @param keys      configured public keys (Ed25519 required; RSA optional).
 * @param onDeprecation invoked once if a request is verified via the legacy RSA
 *                  scheme, so the caller can log a deprecation notice.
 */
export function verifyGhlWebhook(
  rawBody: Buffer,
  headers: { ghlSignature?: string, whSignature?: string },
  keys: GhlWebhookKeys,
  onDeprecation?: () => void
): VerifyOutcome {
  const ghlSig = headers.ghlSignature?.trim()
  const whSig = headers.whSignature?.trim()

  if (!ghlSig && !whSig) return { ok: false, reason: 'no-signature' }

  // CURRENT: Ed25519 over the raw body. Prefer this when present.
  if (ghlSig) {
    const key = loadPublicKey(keys.ed25519PubKeyPem)
    if (!key) return { ok: false, reason: 'no-key' }
    let sigBuf: Buffer
    try {
      sigBuf = Buffer.from(ghlSig, 'base64')
    } catch {
      return { ok: false, reason: 'invalid-signature' }
    }
    try {
      // Ed25519: algorithm MUST be null; the key type selects the curve.
      const valid = cryptoVerify(null, rawBody, key, sigBuf)
      return valid ? { ok: true, scheme: 'ed25519' } : { ok: false, reason: 'invalid-signature' }
    } catch {
      // Primitive unavailable or malformed input — fail closed.
      return { ok: false, reason: 'verify-error' }
    }
  }

  // LEGACY: RSA-SHA256 over the raw body. Only used when no Ed25519 sig present.
  if (whSig) {
    const key = loadPublicKey(keys.rsaPubKeyPem)
    if (!key) return { ok: false, reason: 'no-key' }
    let sigBuf: Buffer
    try {
      sigBuf = Buffer.from(whSig, 'base64')
    } catch {
      return { ok: false, reason: 'invalid-signature' }
    }
    try {
      const valid = cryptoVerify('RSA-SHA256', rawBody, key, sigBuf)
      if (valid) {
        onDeprecation?.()
        return { ok: true, scheme: 'rsa-legacy' }
      }
      return { ok: false, reason: 'invalid-signature' }
    } catch {
      return { ok: false, reason: 'verify-error' }
    }
  }

  return { ok: false, reason: 'no-signature' }
}

/**
 * Constant-time-ish shared-token compare for the UNSIGNED route (GHL Workflow
 * webhook actions carry no signature — docs §A.5/§59). Used as the alternative
 * gate when no public key is configured. Length-leak is acceptable for an opaque
 * random token; we still avoid early-exit on content.
 */
export function safeTokenEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
