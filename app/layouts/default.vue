<script setup lang="ts">
import { computed } from 'vue'
import {
  AudioLines,
  LayoutDashboard,
  ListChecks,
  Phone,
  PlusCircle,
  Settings,
  Users
} from 'lucide-vue-next'
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
const { crumbs } = useBreadcrumb()

interface NavItem {
  label: string
  to: string
  icon: unknown
  match: (path: string) => boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    label: 'Monitor',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard, match: p => p === '/' },
      { label: 'Calls', to: '/calls', icon: Phone, match: p => p.startsWith('/calls') },
      { label: 'Recommendations', to: '/recommendations', icon: ListChecks, match: p => p.startsWith('/recommendations') }
    ]
  },
  {
    label: 'Agents',
    items: [
      { label: 'Agents', to: '/agents', icon: Users, match: p => p === '/agents' || (p.startsWith('/agents/') && !p.startsWith('/agents/new')) },
      { label: 'New agent', to: '/agents/new', icon: PlusCircle, match: p => p.startsWith('/agents/new') }
    ]
  }
]

const settingsActive = computed(() => route.path.startsWith('/settings'))

/** Root crumb is always Overview; pages supply the trail below it. */
const trail = computed(() => crumbs.value)
</script>

<template>
  <SidebarProvider>
    <Sidebar
      collapsible="icon"
      class="border-r"
    >
      <SidebarHeader class="p-3">
        <div class="flex items-center gap-2.5 px-1 py-1">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground elevation-1">
            <AudioLines class="size-5" />
          </div>
          <div class="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span class="text-sm font-semibold tracking-tight">Voice AI Copilot</span>
            <span class="text-[11px] text-muted-foreground">Observability</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent class="px-2">
        <SidebarGroup
          v-for="group in groups"
          :key="group.label"
        >
          <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="item in group.items"
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
            <BreadcrumbItem>
              <BreadcrumbLink
                v-if="trail.length"
                as-child
              >
                <NuxtLink to="/">
                  Overview
                </NuxtLink>
              </BreadcrumbLink>
              <BreadcrumbPage v-else>
                Overview
              </BreadcrumbPage>
            </BreadcrumbItem>

            <template
              v-for="(crumb, i) in trail"
              :key="`${crumb.label}-${i}`"
            >
              <BreadcrumbSeparator />
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
