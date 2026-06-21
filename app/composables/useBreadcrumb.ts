import { computed } from 'vue'

/**
 * A single breadcrumb crumb. `to` omitted = current page (non-clickable leaf).
 */
export interface Crumb {
  label: string
  to?: string
}

/**
 * useBreadcrumb — page-driven breadcrumb trail consumed by the default layout.
 *
 * The layout always prepends a root "Overview" crumb, so pages only supply the
 * trail *below* root. Pages call `setBreadcrumb([...])` (usually in setup or a
 * watcher once the entity name resolves); the layout renders the shared state.
 *
 * SSR-safe via useState (serialized into the payload, hydrated on the client).
 *
 * @example
 *   // pages/agents/[id].vue
 *   const { setBreadcrumb } = useBreadcrumb()
 *   watchEffect(() => setBreadcrumb([
 *     { label: 'Agents', to: '/agents' },
 *     { label: agent.value?.name ?? 'Agent' }
 *   ]))
 */
export function useBreadcrumb() {
  const crumbs = useState<Crumb[]>('breadcrumb', () => [])

  function setBreadcrumb(next: Crumb[]) {
    crumbs.value = next
  }

  function clearBreadcrumb() {
    crumbs.value = []
  }

  return {
    /** Page-supplied trail (below the root Overview crumb). */
    crumbs: computed(() => crumbs.value),
    setBreadcrumb,
    clearBreadcrumb
  }
}
