<script setup lang="ts">
import type { AvailableAction } from '../api/client.js'

/**
 * The buttons a task offers.
 *
 * Rendered from what the daemon sent, never from a list kept here. That is the
 * whole point of serving `actions`: the state machine is in one place, and a
 * client that decided for itself would draw an approve button on something that
 * cannot be approved the first time the rules changed.
 */
defineProps<{
  actions: AvailableAction[]
  busy?: boolean | undefined
  /** Actions worth showing in a crowded row. The rest stay on the detail page. */
  only?: string[] | undefined
}>()
const emit = defineEmits<{ act: [action: string] }>()

const PROMINENT = new Set(['approve', 'queue', 'retry'])
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <button
      v-for="entry in actions.filter((a) => only === undefined || only.includes(a.action))"
      :key="entry.action"
      type="button"
      :disabled="busy"
      :data-testid="`action-${entry.action}`"
      class="rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-40"
      :class="
        PROMINENT.has(entry.action)
          ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/85'
          : 'border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      "
      @click="emit('act', entry.action)"
    >
      {{ entry.label }}
    </button>
  </div>
</template>
