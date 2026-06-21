<script setup lang="ts">
import type { NuxtError } from '#app'
import { computed } from 'vue'
import { AudioLines, Home, RotateCcw, SearchX, ServerCrash } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'

/**
 * App-level error boundary. Nuxt renders this standalone (outside the layout),
 * so it carries its own minimal GHL-native shell. Distinguishes 404 (bad route /
 * missing entity) from 500 (transport / server failure) with a recovery action.
 */
const props = defineProps<{
  error: NuxtError
}>()

const isNotFound = computed(() => props.error?.statusCode === 404)

const heading = computed(() => (isNotFound.value ? 'Page not found' : 'Something went wrong'))

const body = computed(() =>
  isNotFound.value
    ? 'We couldn’t find that page. The link may be out of date, or the agent or call may have been removed.'
    : 'The app hit an unexpected error while loading this page. This is usually temporary — try again, or head back to your overview.'
)

const detail = computed(() => props.error?.statusMessage || props.error?.message || '')

/** Clear the error and navigate home — Nuxt's recommended recovery path. */
function goHome() {
  clearError({ redirect: '/' })
}

/** Re-attempt the current route. */
function tryAgain() {
  clearError({ redirect: useRoute().fullPath })
}

useHead({
  title: computed(() => (isNotFound.value ? 'Page not found' : 'Error')),
  bodyAttrs: { class: 'bg-background text-foreground' }
})
</script>

<template>
  <div class="flex min-h-svh flex-col bg-background text-foreground">
    <header class="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
      <div class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <AudioLines class="size-4" />
      </div>
      <span class="text-sm font-semibold tracking-tight">Voice AI Copilot</span>
    </header>

    <main class="flex flex-1 items-center justify-center p-6">
      <div class="w-full max-w-md text-center">
        <div
          class="mx-auto mb-5 flex size-14 items-center justify-center rounded-full"
          :class="isNotFound ? 'bg-muted text-muted-foreground' : 'bg-danger-soft text-danger'"
        >
          <SearchX
            v-if="isNotFound"
            class="size-7"
          />
          <ServerCrash
            v-else
            class="size-7"
          />
        </div>

        <p class="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Error {{ error?.statusCode || 500 }}
        </p>
        <h1 class="text-2xl font-semibold tracking-tight">
          {{ heading }}
        </h1>
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {{ body }}
        </p>

        <p
          v-if="detail"
          class="mx-auto mt-4 max-w-sm break-words rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground"
        >
          {{ detail }}
        </p>

        <div class="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button @click="goHome">
            <Home class="size-4" />
            Back to overview
          </Button>
          <Button
            v-if="!isNotFound"
            variant="outline"
            @click="tryAgain"
          >
            <RotateCcw class="size-4" />
            Try again
          </Button>
        </div>
      </div>
    </main>
  </div>
</template>
