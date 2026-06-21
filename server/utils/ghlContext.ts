/**
 * Decode the GoHighLevel Custom-Page signed user context.
 *
 * GHL embeds marketplace apps as an iframe inside a "Custom Page". The parent
 * window responds to a `REQUEST_USER_DATA` postMessage with an AES-encrypted
 * blob (the "encryptedData"). It is encrypted with CryptoJS' default scheme,
 * which is OpenSSL-compatible: `aes-256-cbc` with a key + IV derived from the
 * shared secret and an 8-byte random salt via EVP_BytesToKey (MD5 KDF). The
 * ciphertext is base64 and begins with the ASCII marker `Salted__` followed by
 * the salt, then the ciphertext.
 *
 * IMPORTANT: the exact GHL scheme (algorithm, whether the secret is the app's
 * "Shared Secret" verbatim) should be VERIFIED IN-SANDBOX. This implementation
 * mirrors `CryptoJS.AES.decrypt(blob, secret)` which is the documented default.
 * Everything is wrapped so a mismatch returns `null` rather than throwing.
 */
import { createHash, createDecipheriv } from 'node:crypto'

export interface GhlUserContext {
  locationId?: string
  companyId?: string
  userId?: string
  email?: string
  userName?: string
  role?: string
  type?: string
  [k: string]: unknown
}

/**
 * OpenSSL EVP_BytesToKey (MD5) — the KDF CryptoJS uses when you pass a string
 * passphrase. Derives `keyLen + ivLen` bytes from passphrase + salt.
 */
function evpBytesToKey(passphrase: Buffer, salt: Buffer, keyLen: number, ivLen: number): { key: Buffer, iv: Buffer } {
  const total = keyLen + ivLen
  const blocks: Buffer[] = []
  let data: Buffer = Buffer.alloc(0)
  let prev: Buffer = Buffer.alloc(0)
  while (data.length < total) {
    const hash = createHash('md5')
    hash.update(Buffer.concat([prev, passphrase, salt]))
    prev = hash.digest()
    blocks.push(prev)
    data = Buffer.concat(blocks)
  }
  return {
    key: Buffer.from(data.subarray(0, keyLen)),
    iv: Buffer.from(data.subarray(keyLen, total))
  }
}

/**
 * Decrypt a CryptoJS-compatible AES blob. Returns the parsed JSON context, or
 * `null` if the secret is missing, the blob is malformed, or decryption fails.
 */
export function decryptUserContext(encrypted: string, sharedSecret: string): GhlUserContext | null {
  if (!encrypted || !sharedSecret) return null
  try {
    const cipherBuf = Buffer.from(encrypted, 'base64')

    // CryptoJS prepends "Salted__" (8 bytes) + 8-byte salt when a passphrase is used.
    if (cipherBuf.length < 16 || cipherBuf.subarray(0, 8).toString('ascii') !== 'Salted__') {
      return null
    }
    const salt = cipherBuf.subarray(8, 16)
    const ciphertext = cipherBuf.subarray(16)

    const { key, iv } = evpBytesToKey(Buffer.from(sharedSecret, 'utf8'), salt, 32, 16)

    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const text = decrypted.toString('utf8')

    const parsed = JSON.parse(text) as GhlUserContext
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
