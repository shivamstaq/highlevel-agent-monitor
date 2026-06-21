import type { NodeStatus, Severity } from '#shared/types'

/**
 * useTone — the SINGLE source of truth for status color across the app.
 *
 * Every component that paints status (KpiCard deltas, AgentTable bars/badges,
 * SeverityBadge, FindingCard, FlowDiagram dots, CallTimeline latency, FlowDrift)
 * MUST route through these helpers. They return ONLY semantic-token utility
 * classes (text-success / bg-warning-soft / bg-danger ...) — never raw
 * emerald-/amber-/red-/sky-/violet-NNN utilities.
 */

export type Tone = 'success' | 'warning' | 'danger' | 'neutral'

export interface ToneClasses {
  /** Foreground text (e.g. delta numbers, headline score). */
  text: string
  /** Soft tinted background for badges / bar tracks. */
  bg: string
  /** Solid dot / bar-fill. */
  dot: string
  /** Combined badge surface (soft bg + readable foreground). */
  badge: string
}

/**
 * Badge foreground (P22 — WCAG contrast).
 *
 * The `-soft` badge backgrounds are near-white in light mode (oklch L≈0.95) and
 * deep low-chroma tints in dark mode. Painting the badge LABEL with the matching
 * `text-<tone>` base failed AA badly in light mode — measured ~2.0:1 for warning,
 * ~3.0:1 success, ~4.0:1 danger against their soft backgrounds — so "Awaiting
 * review", drift labels, the use-action chip, etc. were unreadable.
 *
 * The `-foreground` tokens don't solve this uniformly: in LIGHT mode only
 * `--warning-foreground` is dark (success/danger foregrounds are near-white,
 * intended as text on the SOLID base), and in DARK mode every `-foreground` is
 * dark (wrong on the dark soft tint). The base `text-<tone>` is the readable one
 * in dark mode (≈5–7:1) but fails in light.
 *
 * The neutral page `--foreground` token is the one foreground that is dark in
 * light and bright in dark, so it clears AA on every soft badge in BOTH modes
 * with a wide margin (measured 13–17:1). The tone identity is still carried by
 * the `-soft` background + the solid dot/bar — only the small label text is
 * neutralized to guarantee legibility. One change, every chip app-wide. */
const BADGE_FOREGROUND = 'text-foreground'

const TONE_CLASSES: Record<Tone, ToneClasses> = {
  success: {
    text: 'text-success',
    bg: 'bg-success-soft',
    dot: 'bg-success',
    badge: `bg-success-soft ${BADGE_FOREGROUND}`
  },
  warning: {
    text: 'text-warning',
    bg: 'bg-warning-soft',
    dot: 'bg-warning',
    badge: `bg-warning-soft ${BADGE_FOREGROUND}`
  },
  danger: {
    text: 'text-danger',
    bg: 'bg-danger-soft',
    dot: 'bg-danger',
    badge: `bg-danger-soft ${BADGE_FOREGROUND}`
  },
  neutral: {
    text: 'text-muted-foreground',
    bg: 'bg-muted',
    dot: 'bg-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground'
  }
}

/** Map an arbitrary tone to its token class set. */
export function toneClasses(tone: Tone): ToneClasses {
  return TONE_CLASSES[tone]
}

/**
 * Map a 0–100 score to a tone band:
 *  >= 80 healthy (success) · >= 60 at-risk (warning) · else critical (danger).
 * Pass `null` (un-analyzed) to get the neutral tone.
 */
export function scoreToneName(score: number | null | undefined): Tone {
  if (score == null) return 'neutral'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

/** Foreground text class for a score (e.g. headline + table score column). */
export function scoreTone(score: number | null | undefined): string {
  return TONE_CLASSES[scoreToneName(score)].text
}

/** Full token class set for a score (text + bg + dot + badge). */
export function scoreToneSet(score: number | null | undefined): ToneClasses {
  return TONE_CLASSES[scoreToneName(score)]
}

/** Human band label for a score (used by status pills). */
export function scoreBandLabel(score: number | null | undefined): string {
  if (score == null) return 'Not scored'
  if (score >= 80) return 'Healthy'
  if (score >= 60) return 'At risk'
  return 'Critical'
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  low: 'success',
  medium: 'warning',
  high: 'danger'
}

/** Token classes for a finding/recommendation severity (null = neutral). */
export function severityTone(severity: Severity | null | undefined): ToneClasses {
  if (severity == null) return TONE_CLASSES.neutral
  return TONE_CLASSES[SEVERITY_TONE[severity]]
}

export function severityLabel(severity: Severity | null | undefined): string {
  switch (severity) {
    case 'high': return 'High'
    case 'medium': return 'Medium'
    case 'low': return 'Low'
    default: return 'None'
  }
}

/**
 * Flow-conformance node status -> token classes.
 *  hit = success · skipped = warning · out_of_order = warning · extra = danger.
 * (Skipping a *conditional* node is not drift — callers gate on `expected`.)
 */
const STATUS_TONE: Record<NodeStatus, Tone> = {
  hit: 'success',
  skipped: 'warning',
  out_of_order: 'warning',
  extra: 'danger'
}

export function statusTone(status: NodeStatus | null | undefined): ToneClasses {
  if (status == null) return TONE_CLASSES.neutral
  return TONE_CLASSES[STATUS_TONE[status]]
}

export function statusLabel(status: NodeStatus | null | undefined): string {
  switch (status) {
    case 'hit': return 'Hit'
    case 'skipped': return 'Skipped'
    case 'out_of_order': return 'Out of order'
    case 'extra': return 'Extra'
    default: return 'Unknown'
  }
}

/** Composable form for ergonomic `const tone = useTone()` usage in <script setup>. */
export function useTone() {
  return {
    toneClasses,
    scoreTone,
    scoreToneName,
    scoreToneSet,
    scoreBandLabel,
    severityTone,
    severityLabel,
    statusTone,
    statusLabel
  }
}
