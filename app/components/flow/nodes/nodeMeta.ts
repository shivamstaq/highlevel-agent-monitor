// CREATED (our eval layer) — shared node presentation metadata for FlowCanvas.
/**
 * Node-type presentation map for the shared <FlowCanvas>.
 *
 * The five FlowNodeType values (trigger | llm | router | action | endCall) echo
 * GHL Agent Studio's node language (Start Call / AI Agent / Router / Action /
 * End Call). Each type gets a distinct icon + a NEUTRAL accent chip — the node
 * TYPE is communicated by icon + label, never by status color. Conformance
 * status coloring is a separate overlay (see <FlowCanvas> + useTone), so the two
 * channels (what a node IS vs how the call CONFORMED) never collide.
 */
import {
  Bot,
  CircleStop,
  GitBranch,
  PlayCircle,
  Zap
} from 'lucide-vue-next'
import type { FlowNodeType, NodeStatus } from '#shared/types'

export interface NodeTypeMeta {
  label: string
  icon: typeof Bot
  /** Tailwind classes for the small type chip (neutral, GHL-flavored hues). */
  chip: string
  /** Icon color class for the chip glyph. */
  glyph: string
}

/**
 * Per-type chip styling. These are gentle, low-chroma hues that nod to GHL's
 * node palette WITHOUT competing with the conformance overlay (which owns the
 * success/warning/danger semantic tokens). They tint only the small type chip.
 */
export const NODE_TYPE_META: Record<FlowNodeType, NodeTypeMeta> = {
  trigger: {
    label: 'Start Call',
    icon: PlayCircle,
    chip: 'bg-primary/10 text-primary',
    glyph: 'text-primary'
  },
  llm: {
    label: 'AI Agent',
    icon: Bot,
    chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    glyph: 'text-violet-600 dark:text-violet-400'
  },
  router: {
    label: 'Router',
    icon: GitBranch,
    chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    glyph: 'text-sky-600 dark:text-sky-400'
  },
  action: {
    label: 'Action',
    icon: Zap,
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    glyph: 'text-amber-600 dark:text-amber-400'
  },
  endCall: {
    label: 'End Call',
    icon: CircleStop,
    chip: 'bg-muted text-muted-foreground',
    glyph: 'text-muted-foreground'
  }
}

export function nodeTypeMeta(type: FlowNodeType): NodeTypeMeta {
  return NODE_TYPE_META[type] ?? NODE_TYPE_META.llm
}

/**
 * Conformance-overlay ring/border classes by status. Kept as a literal map (not
 * string-built) so Tailwind's static scanner emits these utilities. Mirrors the
 * useTone bands: hit=success, skipped/out_of_order=warning, extra=danger.
 */
export const STATUS_OVERLAY: Record<NodeStatus, { ring: string, badge: string, label: string }> = {
  hit: { ring: 'ring-2 ring-success', badge: 'bg-success-soft text-foreground', label: 'Hit' },
  skipped: { ring: 'ring-2 ring-warning', badge: 'bg-warning-soft text-foreground', label: 'Skipped' },
  out_of_order: { ring: 'ring-2 ring-warning', badge: 'bg-warning-soft text-foreground', label: 'Out of order' },
  extra: { ring: 'ring-2 ring-danger', badge: 'bg-danger-soft text-foreground', label: 'Extra' }
}
