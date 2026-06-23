<script setup lang="ts">
import { computed } from 'vue'
import {
  AudioLines,
  Phone,
  Settings,
  Users
} from 'lucide-vue-next'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from '~/components/ui/sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '~/components/ui/breadcrumb'
import { Toaster } from '~/components/ui/sonner'
import { useBreadcrumb } from '~/composables/useBreadcrumb'

const route = useRoute()
const { trail } = useBreadcrumb()

interface NavItem {
  label: string
  to: string
  icon: unknown
  match: (path: string) => boolean
}

/**
 * Operator nav is deliberately minimal: the two surfaces an operator actually
 * works in — Call logs and Agents. Overview / Recommendations / the create-agent
 * flow were removed (read/mirror product, no authoring). Settings stays in the
 * footer because it configures the analysis engine (provider/keys).
 */
const items: NavItem[] = [
  { label: 'Call logs', to: '/calls', icon: Phone, match: p => p.startsWith('/calls') },
  { label: 'Agents', to: '/agents', icon: Users, match: p => p.startsWith('/agents') }
]

const settingsActive = computed(() => route.path.startsWith('/settings'))
</script>

<template>
  <SidebarProvider :default-open="false">
    <Sidebar
      collapsible="icon"
      class="border-r"
    >
      <SidebarHeader class="p-3">
        <NuxtLink
          to="/agents"
          class="flex items-center gap-2.5 rounded-md px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground elevation-1">
            <AudioLines class="size-5" />
          </div>
          <div class="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span class="text-sm font-semibold tracking-tight">Voice AI Copilot</span>
            <span class="text-[11px] text-muted-foreground">Observability</span>
          </div>
        </NuxtLink>
      </SidebarHeader>

      <SidebarContent class="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="item in items"
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

      <SidebarFooter class="p-2">
        <SidebarGroupLabel class="group-data-[collapsible=icon]:hidden">
          Configure
        </SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              as-child
              :is-active="settingsActive"
              tooltip="Settings"
            >
              <NuxtLink to="/settings">
                <Settings />
                <span>Settings</span>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="min-w-0">
      <header class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
        <SidebarTrigger class="-ml-1" />
        <div class="h-5 w-px bg-border" />
        <Breadcrumb>
          <BreadcrumbList>
            <template
              v-for="(crumb, i) in trail"
              :key="`${crumb.label}-${i}`"
            >
              <BreadcrumbSeparator v-if="i > 0" />
              <BreadcrumbItem>
                <BreadcrumbLink
                  v-if="crumb.to && i < trail.length - 1"
                  as-child
                >
                  <NuxtLink :to="crumb.to">
                    {{ crumb.label }}
                  </NuxtLink>
                </BreadcrumbLink>
                <BreadcrumbPage
                  v-else
                  class="max-w-[40ch] truncate"
                >
                  {{ crumb.label }}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </template>
          </BreadcrumbList>
        </Breadcrumb>
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
