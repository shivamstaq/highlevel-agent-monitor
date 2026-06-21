<script setup lang="ts">
useHead({
  /**
   * One app-wide title template with a consistent middot separator (R3-10/P29).
   * Pages set only their own page-specific title segment (e.g. "Overview",
   * "Calls", "{contact} · Call") and this appends the product name, so every
   * document title reads "{Page} · Voice AI Copilot" instead of the previous
   * mix of middot / em-dash / no-separator suffixes hand-typed per page.
   * When a page supplies no title, fall back to the bare product name.
   */
  titleTemplate: (title?: string) => (title ? `${title} · Voice AI Copilot` : 'Voice AI Copilot'),
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en' }
})

useSeoMeta({
  description: 'Autonomous monitoring and analysis for HighLevel Voice AI agents.'
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
