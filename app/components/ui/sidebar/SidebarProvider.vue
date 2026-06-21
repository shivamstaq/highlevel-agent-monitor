<script setup lang="ts">
import type { HTMLAttributes, Ref } from 'vue'
import { defaultDocument, useEventListener, useMediaQuery, useVModel } from '@vueuse/core'
import { TooltipProvider } from 'reka-ui'
import { computed, onMounted, ref } from 'vue'
import { cn } from '~/lib/utils'
import { provideSidebarContext, SIDEBAR_COOKIE_MAX_AGE, SIDEBAR_COOKIE_NAME, SIDEBAR_KEYBOARD_SHORTCUT, SIDEBAR_WIDTH, SIDEBAR_WIDTH_ICON } from './utils'

const props = withDefaults(defineProps<{
  defaultOpen?: boolean
  open?: boolean
  class?: HTMLAttributes['class']
}>(), {
  defaultOpen: !defaultDocument?.cookie.includes(`${SIDEBAR_COOKIE_NAME}=false`),
  open: undefined
})

const emits = defineEmits<{
  'update:open': [open: boolean]
}>()

/**
 * Hydration-safe mobile detection (R3-08).
 *
 * `useMediaQuery` reports `false` during SSR (no `window`), so the server always
 * renders Sidebar's desktop branch. On a narrow client viewport the raw query
 * flips to `true` immediately, which made Sidebar's `v-else-if="isMobile"` Sheet
 * branch replace the server's desktop `v-else` branch on the very first client
 * render — a Vue hydration mismatch that threw on every page.
 *
 * We gate the exposed `isMobile` behind a `hydrated` flag that only flips inside
 * `onMounted` (after hydration). The first client render therefore matches the
 * server (desktop), and the app deterministically switches to the mobile Sheet
 * one tick later. `rawIsMobile` stays live so the switch is correct post-mount. */
const rawIsMobile = useMediaQuery('(max-width: 768px)')
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})
const isMobile = computed(() => hydrated.value && rawIsMobile.value)
const openMobile = ref(false)

const open = useVModel(props, 'open', emits, {
  defaultValue: props.defaultOpen ?? false,
  passive: (props.open === undefined) as false
}) as Ref<boolean>

function setOpen(value: boolean) {
  open.value = value // emits('update:open', value)

  // This sets the cookie to keep the sidebar state.
  document.cookie = `${SIDEBAR_COOKIE_NAME}=${open.value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
}

function setOpenMobile(value: boolean) {
  openMobile.value = value
}

// Helper to toggle the sidebar.
function toggleSidebar() {
  return isMobile.value ? setOpenMobile(!openMobile.value) : setOpen(!open.value)
}

useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    toggleSidebar()
  }
})

// We add a state so that we can do data-state="expanded" or "collapsed".
// This makes it easier to style the sidebar with Tailwind classes.
const state = computed(() => open.value ? 'expanded' : 'collapsed')

provideSidebarContext({
  state,
  open,
  setOpen,
  isMobile,
  openMobile,
  setOpenMobile,
  toggleSidebar
})
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <div
      data-slot="sidebar-wrapper"
      :style="{
        '--sidebar-width': SIDEBAR_WIDTH,
        '--sidebar-width-icon': SIDEBAR_WIDTH_ICON
      }"
      :class="cn('group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full', props.class)"
      v-bind="$attrs"
    >
      <slot />
    </div>
  </TooltipProvider>
</template>
