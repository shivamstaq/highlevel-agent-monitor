import { computed } from 'vue'

/**
 * A single breadcrumb crumb. `to` omitted = current page (non-clickable leaf).
 */
export interface Crumb {
  label: string
  to?: string
}

/**
 * useBreadcrumb — SSR-correct breadcrumb trail for the default layout.
 *
 * ## Why the previous approach rendered only "Overview" server-side
 *
 * During SSR the default **layout** is the parent of `<NuxtPage>`, so its
 * `<header>` (including the breadcrumb) is serialized to HTML *before* any page
 * `<script setup>` runs. Pages set the trail with `setBreadcrumb([...])`, but by
 * the time that mutation lands the layout's vnodes are already flushed — SSR
 * renders once and does not re-render on a later reactive write. The mutated
 * value still ends up in the Nuxt payload (which is why the crumb appeared after
 * hydration), producing the client-only flash the punch list (P07) describes.
 * Calling `setBreadcrumb` synchronously at the top of setup does NOT help,
 * because the whole page setup runs after the layout has rendered.
 *
 * ## The fix: derive the trail in the layout from the route
 *
 * The trail is now computed **synchronously from the current route** every time
 * the layout reads it. Because the route is known the instant the layout renders
 * (no page setup required), the correct trail — `Overview / Agents`,
 * `Overview / Calls / <leaf>`, etc. — is present in the INITIAL SSR HTML with no
 * client-only flash.
 *
 * Pages may still call `setBreadcrumb([...])` to *override* the route-derived
 * trail (e.g. to swap the entity id for a resolved name once awaited data is
 * available — `Agents / Jane Doe`). That override is stored in SSR-safe
 * `useState`, merged in when present, and simply enhances the leaf after
 * hydration / on client-side navigation. The route-derived trail is the floor,
 * so the SSR render is never empty even before the override exists.
 *
 * @example
 *   // pages/agents/[id].vue — override the leaf with the resolved name
 *   const { setBreadcrumb } = useBreadcrumb()
 *   watchEffect(() => setBreadcrumb([
 *     { label: 'Agents', to: '/agents' },
 *     { label: agent.value?.name ?? 'Agent' }
 *   ]))
 */

/**
 * Top-level destinations are siblings (Overview / Calls / Agents / Settings),
 * not a hierarchy — so we do NOT assert "Overview" as the parent of Calls or
 * Agents. The root crumb is the page's own nav group/destination; only true
 * descendants (a detail page under its list) add ancestors.
 *
 * Each entry maps the first path segment to its label and list route, and
 * declares whether a deeper segment is a child (gets the list as an ancestor)
 * or a sibling section that stands alone.
 */
interface SegmentRoute {
  /** Human label for the section's index/list page. */
  label: string
  /** Route of the section's list/index page (the clickable ancestor). */
  to: string
}

const SECTION_ROUTES: Record<string, SegmentRoute> = {
  calls: { label: 'Calls', to: '/calls' },
  agents: { label: 'Agents', to: '/agents' },
  recommendations: { label: 'Recommendations', to: '/recommendations' },
  settings: { label: 'Settings', to: '/settings' }
}

/**
 * Labels for known *named* second segments (static child routes such as
 * `/agents/new`). Dynamic ids fall through to a generic leaf label that page
 * overrides replace with the resolved entity name.
 */
const NAMED_LEAF_LABELS: Record<string, Record<string, string>> = {
  agents: { new: 'New agent' }
}

/** Generic leaf label for a dynamic detail route before its name resolves. */
const DETAIL_FALLBACK_LABEL: Record<string, string> = {
  agents: 'Agent',
  calls: 'Call'
}

/**
 * Build the canonical trail from a path alone (no page involvement), so the
 * layout can render a correct breadcrumb in the very first SSR pass.
 *
 * Examples:
 *   '/'                 -> [Overview]                    (top-level, leaf)
 *   '/agents'           -> [Agents]                      (top-level, leaf)
 *   '/agents/new'       -> [Agents ›] [New agent]
 *   '/agents/abc123'    -> [Agents ›] [Agent]            (leaf replaced by name override)
 *   '/calls/call-001'   -> [Calls ›]  [Call]
 *   '/settings'         -> [Settings]                    (top-level, leaf)
 */
export function trailFromPath(path: string): Crumb[] {
  const clean = path.split('?')[0]?.split('#')[0] ?? '/'
  const segments = clean.split('/').filter(Boolean)

  // Root / Overview is a top-level sibling, rendered as the standalone leaf.
  if (segments.length === 0) return [{ label: 'Overview' }]

  const [head, child] = segments
  const section = head ? SECTION_ROUTES[head] : undefined

  // Unknown top-level route: best-effort single readable crumb.
  if (!section) {
    return [{ label: titleizeSegment(head ?? 'Overview') }]
  }

  // Top-level list/index page: standalone leaf (no false ancestor).
  if (!child) return [{ label: section.label }]

  // Deeper page: section list becomes the clickable ancestor, child the leaf.
  const named = head ? NAMED_LEAF_LABELS[head]?.[child] : undefined
  const leafLabel = named ?? (head ? DETAIL_FALLBACK_LABEL[head] : undefined) ?? titleizeSegment(child)

  return [
    { label: section.label, to: section.to },
    { label: leafLabel }
  ]
}

/** Fallback humanizer for unexpected segments ('foo-bar' -> 'Foo bar'). */
function titleizeSegment(seg: string): string {
  const words = seg.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function useBreadcrumb() {
  const route = useRoute()

  /**
   * Optional page-supplied override. When a page sets this (typically to swap a
   * detail-route id for a resolved entity name), it takes precedence over the
   * route-derived trail. Stored in `useState` so it survives SSR -> client.
   */
  const override = useState<Crumb[] | null>('breadcrumb', () => null)

  function setBreadcrumb(next: Crumb[]) {
    override.value = next
  }

  function clearBreadcrumb() {
    override.value = null
  }

  /**
   * The trail the layout renders. Derived synchronously from the route so the
   * first SSR render is already correct; a page override (when present) wins so
   * the resolved entity name replaces the generic leaf after data loads.
   *
   * The override is gated to the current path's depth so a stale override from a
   * previous route never bleeds into the next page before that page re-sets it.
   */
  const trail = computed<Crumb[]>(() => {
    const derived = trailFromPath(route.path)
    const ov = override.value
    // Accept the override only when it matches the current route's shape: same
    // depth AND the same ancestor `to` targets. This lets a page swap the leaf
    // label (id -> resolved name) while rejecting a stale override left over
    // from a previous, structurally-different route during client navigation.
    if (ov && ov.length === derived.length
      && ov.every((c, i) => c.to === derived[i]?.to)) {
      return ov
    }
    return derived
  })

  return {
    /** Full breadcrumb trail (route-derived, override-enhanced) for the layout. */
    trail,
    /**
     * Page-supplied trail override (the resolved-name version). Back-compat
     * alias kept so existing `const { crumbs } = useBreadcrumb()` reads work.
     */
    crumbs: trail,
    setBreadcrumb,
    clearBreadcrumb
  }
}
