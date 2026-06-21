/**
 * Pure presentation formatters shared across the dashboard.
 *
 * Everything here is SSR-safe and dependency-free so it renders identically on
 * the server and after client hydration (no Intl locale drift). Components and
 * pages import these instead of re-implementing humanizers per-file (P08).
 */

/**
 * Turn a raw machine outcome token into clean, human Title-style copy.
 *
 * The API ships snake_case outcomes (qualified_not_booked, not_booked,
 * qualified_booked, cancelled, resolved, booked, ...) which read as an
 * unfinished dev build when printed verbatim in the inbox, the call-header
 * badge, and the outcome filter. Route the LABEL through this helper while
 * keeping the raw value as the filter key (P08).
 *
 *   qualified_not_booked -> "Qualified, not booked"
 *   qualified_booked     -> "Qualified, booked"
 *   not_booked           -> "Not booked"
 *   resolved             -> "Resolved"
 *
 * Unknown tokens degrade gracefully: underscores/dashes become spaces and the
 * first word is capitalized, so a new outcome never leaks raw snake_case.
 */
export function humanizeOutcome(outcome: string | null | undefined): string {
  if (!outcome) return '—'
  const raw = outcome.trim()
  if (!raw) return '—'

  // A small set of outcomes carry a natural comma ("qualified, not booked")
  // that a blind word-split can't recover, so spell those out explicitly.
  const SPECIAL: Record<string, string> = {
    qualified_not_booked: 'Qualified, not booked',
    qualified_booked: 'Qualified, booked'
  }
  const key = raw.toLowerCase()
  if (SPECIAL[key]) return SPECIAL[key]

  const words = key.split(/[_-]+/).filter(Boolean)
  if (words.length === 0) return '—'
  // Sentence-ish Title style: capitalize the first word, keep the rest lower so
  // it reads as clean copy ("Not booked", "Qualified booked") rather than shouty.
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * SSR-safe relative time ("just now", "5m ago", "3h ago", "4d ago", "2w ago",
 * then an absolute "Mon D" fallback). Computed from epoch millis so the server
 * and client agree without pulling in Intl locale data. Returns "—" for an
 * unparseable timestamp.
 *
 * `nowMs` is injectable for deterministic tests; defaults to Date.now().
 */
export function relativeTime(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'

  const diffSec = Math.round((nowMs - then) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 60) return 'just now'

  const mins = Math.round(diffSec / 60)
  if (Math.abs(mins) < 60) return `${mins}m ago`

  const hrs = Math.round(diffSec / 3600)
  if (Math.abs(hrs) < 24) return `${hrs}h ago`

  const days = Math.round(diffSec / 86400)
  if (Math.abs(days) < 7) return `${days}d ago`

  const weeks = Math.round(days / 7)
  if (Math.abs(weeks) < 5) return `${weeks}w ago`

  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Defensive sentence-case normalizer for model-authored strings (recommendation
 * titles drift between Title Case and sentence case). Lowercases everything but
 * the first character while PRESERVING all-caps acronyms (API, GHL, EOU, TTS)
 * and leaving already-mixed proper nouns alone. Pure and idempotent.
 */
export function toSentenceCase(text: string | null | undefined): string {
  if (!text) return ''
  const trimmed = text.trim().replace(/\.+$/, '') // drop trailing period(s)
  if (!trimmed) return ''

  const words = trimmed.split(/\s+/).map((word, i) => {
    // Keep acronyms / known proper-noun casing (2+ consecutive capitals).
    if (/[A-Z]{2,}/.test(word)) return word
    if (i === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    return word.toLowerCase()
  })
  return words.join(' ')
}
