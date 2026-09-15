<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { computed } from 'vue'
import ProjectRail from './ProjectRail.vue'

const route = useRoute()

/**
 * Grouped by what each page is about, not by how often it is used.
 *
 * Eight flat entries gave no clue that Tasks and Scopes answer completely
 * different kinds of question. Three groups do: what is happening, what you
 * author, and how this installation is put together.
 *
 * The first has no heading. It is what you open Factory to look at, and a
 * label above it would only name the obvious.
 */
const nav: { heading?: string; items: { to: string; label: string }[] }[] = [
  {
    items: [
      { to: '/tasks', label: 'Tasks' },
      { to: '/environments', label: 'Environments' },
    ],
  },
  {
    heading: 'Library',
    items: [
      { to: '/workflows', label: 'Workflows' },
      { to: '/phases', label: 'Phases' },
      { to: '/agents', label: 'Agents' },
      { to: '/bundles/import', label: 'Import' },
    ],
  },
  {
    heading: 'System',
    items: [
      { to: '/projects', label: 'Projects' },
      { to: '/scopes', label: 'Scopes' },
      { to: '/plugins', label: 'Plugins' },
      { to: '/settings', label: 'Settings' },
      { to: '/setup', label: 'Setup' },
    ],
  },
]

const current = computed(() => route.path)
</script>

<template>
  <!-- The shell owns the viewport and `main` is the scroller, so the rails stay
       put on a long page. They used to be ordinary in-flow children stretched
       to the height of the whole document, which scrolled them off the top —
       and put the tagline below at the bottom of the *page* rather than the
       window. The editor pages already did it this way and never had the bug. -->
  <div class="app-viewport flex">
    <ProjectRail />

    <nav
      class="app-nav flex w-52 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]"
    >
      <div class="flex items-center gap-2 px-5 py-5">
        <span class="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-[var(--color-accent)]" />
        <span class="font-mono text-[13px] font-medium tracking-[0.18em] uppercase">Factory</span>
      </div>

      <div v-for="(section, index) in nav" :key="section.heading ?? index" class="px-2">
        <p
          v-if="section.heading"
          class="mt-5 mb-1 px-3 font-mono text-[10px] tracking-widest text-[var(--color-ink-faint)] uppercase"
          :data-testid="`nav-section-${section.heading.toLowerCase()}`"
        >
          {{ section.heading }}
        </p>
        <ul class="flex flex-col gap-0.5">
          <li v-for="item in section.items" :key="item.to">
            <RouterLink
              :to="item.to"
              :data-testid="`nav-${item.label.toLowerCase()}`"
              class="block rounded-md px-3 py-2 text-sm transition-colors"
              :class="
                current.startsWith(item.to)
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-muted)] hover:bg-white/[0.03] hover:text-[var(--color-ink)]'
              "
            >
              {{ item.label }}
            </RouterLink>
          </li>
        </ul>
      </div>

      <div class="mt-auto px-5 py-4 font-mono text-[10px] text-[var(--color-ink-faint)]">
        Don't replace your tools.<br />Orchestrate them.
      </div>
    </nav>

    <main class="min-w-0 flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
