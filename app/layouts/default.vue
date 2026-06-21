<script setup lang="ts">
import { computed } from 'vue'
import { AudioLines, LayoutDashboard, PlusCircle } from 'lucide-vue-next'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from '~/components/ui/sidebar'
import { Toaster } from '~/components/ui/sonner'

const route = useRoute()

const nav = [
  { label: 'Overview', to: '/', icon: LayoutDashboard, match: (p: string) => p === '/' },
  { label: 'New agent', to: '/agents/new', icon: PlusCircle, match: (p: string) => p.startsWith('/agents/new') }
]

const crumb = computed(() => {
  if (route.path === '/agents/new') return 'New agent'
  if (route.path.startsWith('/agents/')) return 'Agent detail'
  if (route.path.startsWith('/calls/')) return 'Call analysis'
  return 'Overview'
})
</script>

<template>
  <SidebarProvider>
    <Sidebar
      collapsible="icon"
      class="border-r"
    >
      <SidebarHeader class="p-3">
        <div class="flex items-center gap-2.5 px-1 py-1">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <AudioLines class="size-5" />
          </div>
          <div class="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span class="text-sm font-semibold tracking-tight">Voice AI Copilot</span>
            <span class="text-[11px] text-muted-foreground">Observability</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent class="px-2">
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="item in nav"
                :key="item.label"
              >
                <SidebarMenuButton
                  as-child
                  :is-active="item.match(route.path)"
                  :tooltip="item.label"
                >
                  <NuxtLink :to="item.to">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </NuxtLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter class="p-3">
        <div class="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">
          <p class="font-medium text-foreground">
            HighLevel Voice AI
          </p>
          <p>Autonomous QA across your agent fleet.</p>
        </div>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="min-w-0">
      <header class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
        <SidebarTrigger class="-ml-1" />
        <div class="h-5 w-px bg-border" />
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">Voice AI Copilot</span>
          <span class="text-muted-foreground">/</span>
          <span class="text-muted-foreground">{{ crumb }}</span>
        </div>
      </header>

      <main class="flex-1 overflow-x-hidden">
        <slot />
      </main>
    </SidebarInset>

    <Toaster
      rich-colors
      position="top-right"
    />
  </SidebarProvider>
</template>
