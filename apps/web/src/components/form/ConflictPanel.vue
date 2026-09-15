<script setup lang="ts">
/**
 * The file changed underneath you.
 *
 * Someone edited it in a terminal, another tab saved, a branch was checked out.
 * Overwriting silently would lose work Factory never saw, so the choice is put
 * to the person who has the context: take theirs, or keep yours.
 */
defineProps<{ raw: string }>()
defineEmits<{ reload: []; overwrite: []; dismiss: [] }>()
</script>

<template>
  <div
    class="border-b border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 px-6 py-3"
    data-testid="conflict"
  >
    <p class="text-sm text-[var(--color-warn)]">
      This file changed on disk since you opened it. Nothing has been written.
    </p>
    <pre
      class="value mt-2 max-h-40 overflow-auto rounded-md bg-[var(--color-base)] px-3 py-2 text-[11px] text-[var(--color-ink-muted)]"
      data-testid="conflict-current"
    >{{ raw }}</pre>
    <div class="mt-2 flex gap-2">
      <button
        type="button"
        class="rounded-md border border-[var(--color-line)] px-3 py-1 text-xs text-[var(--color-ink)]"
        data-testid="conflict-reload"
        @click="$emit('reload')"
      >
        Discard mine and reload
      </button>
      <button
        type="button"
        class="rounded-md border border-[var(--color-warn)]/50 px-3 py-1 text-xs text-[var(--color-warn)]"
        data-testid="conflict-overwrite"
        @click="$emit('overwrite')"
      >
        Overwrite with mine
      </button>
    </div>
  </div>
</template>
