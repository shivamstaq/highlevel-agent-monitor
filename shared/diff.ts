/**
 * CREATED — minimal git-style line diff for the write-back review UI.
 *
 * LCS over lines → unified hunks with N lines of context and `@@ -a,b +c,d @@`
 * headers. No dependency; the result drives `DiffView.vue`. Intended for the
 * short prompt/node texts the flywheel edits (not large files), so the O(n·m)
 * LCS table is fine.
 */
export type DiffLineType = 'context' | 'add' | 'del'
export interface DiffLine { type: DiffLineType, text: string, oldNo: number | null, newNo: number | null }
export interface DiffHunk { header: string, oldStart: number, newStart: number, lines: DiffLine[] }

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  return dp
}

type Op = { type: DiffLineType, text: string }

/** Full per-line op stream (context/add/del) via LCS backtrace. */
function diffOps(before: string, after: string): Op[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const dp = lcsTable(a, b)
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', text: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'del', text: a[i]! })
      i++
    } else {
      ops.push({ type: 'add', text: b[j]! })
      j++
    }
  }
  while (i < a.length) {
    ops.push({ type: 'del', text: a[i]! })
    i++
  }
  while (j < b.length) {
    ops.push({ type: 'add', text: b[j]! })
    j++
  }
  return ops
}

/** Group ops into unified hunks with `context` lines of surrounding context. */
export function diffLines(before: string, after: string, context = 3): DiffHunk[] {
  const ops = diffOps(before, after)
  // Mark which op indices are within `context` of a change.
  const changed = ops.map(o => o.type !== 'context')
  const keep = new Array(ops.length).fill(false)
  for (let k = 0; k < ops.length; k++) {
    if (!changed[k]) continue
    for (let d = -context; d <= context; d++) {
      const idx = k + d
      if (idx >= 0 && idx < ops.length) keep[idx] = true
    }
  }

  const hunks: DiffHunk[] = []
  let oldNo = 1, newNo = 1
  let cur: DiffHunk | null = null
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!
    const lineOldNo = op.type === 'add' ? null : oldNo
    const lineNewNo = op.type === 'del' ? null : newNo
    if (keep[k]) {
      if (!cur) cur = { header: '', oldStart: oldNo, newStart: newNo, lines: [] }
      cur.lines.push({ type: op.type, text: op.text, oldNo: lineOldNo, newNo: lineNewNo })
    } else if (cur) {
      hunks.push(cur)
      cur = null
    }
    if (op.type !== 'add') oldNo++
    if (op.type !== 'del') newNo++
  }
  if (cur) hunks.push(cur)

  for (const h of hunks) {
    const oldLen = h.lines.filter(l => l.type !== 'add').length
    const newLen = h.lines.filter(l => l.type !== 'del').length
    h.header = `@@ -${h.oldStart},${oldLen} +${h.newStart},${newLen} @@`
  }
  return hunks
}

/* ----------------------------------------------------------------------------
 * Intra-line (word-level) highlighting. Line diffs are near-useless for the
 * single-long-line prompts GHL agents use, so we additionally word-diff each
 * deleted-run vs the following added-run and expose per-line segments the UI can
 * highlight (GitHub-style). Changed words get emphasis; unchanged words stay calm.
 * -------------------------------------------------------------------------- */
export interface Seg { text: string, changed: boolean }
export interface RichLine { type: DiffLineType, text: string, oldNo: number | null, newNo: number | null, segs: Seg[] }

function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter(t => t.length > 0)
}

function pushSeg(out: Seg[], text: string, changed: boolean): void {
  const last = out[out.length - 1]
  if (last && last.changed === changed) last.text += text
  else out.push({ text, changed })
}

/** Word-level diff of two strings → per-side segment streams. */
export function wordSegments(before: string, after: string): { del: Seg[], add: Seg[] } {
  const a = tokenize(before), b = tokenize(after)
  const dp = lcsTable(a, b)
  const del: Seg[] = []
  const add: Seg[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushSeg(del, a[i]!, false)
      pushSeg(add, b[j]!, false)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      pushSeg(del, a[i]!, true)
      i++
    } else {
      pushSeg(add, b[j]!, true)
      j++
    }
  }
  while (i < a.length) {
    pushSeg(del, a[i]!, true)
    i++
  }
  while (j < b.length) {
    pushSeg(add, b[j]!, true)
    j++
  }
  return { del, add }
}

/** Split a segment stream back into per-line segment arrays on '\n'. */
function segsToLines(segs: Seg[]): Seg[][] {
  const lines: Seg[][] = [[]]
  for (const seg of segs) {
    const parts = seg.text.split('\n')
    for (let k = 0; k < parts.length; k++) {
      if (k > 0) lines.push([])
      if (parts[k]!.length > 0) lines[lines.length - 1]!.push({ text: parts[k]!, changed: seg.changed })
    }
  }
  return lines
}

/** Enrich a hunk's lines with word-level segments (pairs del-runs with add-runs). */
export function enrichHunk(hunk: DiffHunk): RichLine[] {
  const out: RichLine[] = []
  const lines = hunk.lines
  let k = 0
  while (k < lines.length) {
    const line = lines[k]!
    if (line.type === 'context') {
      out.push({ ...line, segs: [{ text: line.text, changed: false }] })
      k++
      continue
    }
    // Gather a maximal del-run then the immediately-following add-run.
    const dels = []
    while (k < lines.length && lines[k]!.type === 'del') {
      dels.push(lines[k]!)
      k++
    }
    const adds = []
    while (k < lines.length && lines[k]!.type === 'add') {
      adds.push(lines[k]!)
      k++
    }

    if (dels.length && adds.length) {
      const { del, add } = wordSegments(dels.map(l => l.text).join('\n'), adds.map(l => l.text).join('\n'))
      const delLines = segsToLines(del), addLines = segsToLines(add)
      dels.forEach((l, idx) => out.push({ ...l, segs: delLines[idx] ?? [{ text: l.text, changed: true }] }))
      adds.forEach((l, idx) => out.push({ ...l, segs: addLines[idx] ?? [{ text: l.text, changed: true }] }))
    } else {
      // pure add or pure delete — whole line is the change
      for (const l of [...dels, ...adds]) out.push({ ...l, segs: [{ text: l.text, changed: true }] })
    }
  }
  return out
}

export function diffStat(hunks: DiffHunk[]): { additions: number, deletions: number } {
  let additions = 0, deletions = 0
  for (const h of hunks) for (const l of h.lines) {
    if (l.type === 'add') additions++
    else if (l.type === 'del') deletions++
  }
  return { additions, deletions }
}
