<script setup lang="ts">
import { ref } from 'vue'
import type { Problem } from '../../api/client.js'
import ViewToggle from './ViewToggle.vue'

/**
 * The split view every editor uses: form on the left, the file on the right.
 *
 * Two panes rather than a tab, because the point is to see the effect of a
 * field on the thing that gets written — a config editor where you have to
 * switch views to check your work is a config editor people stop trusting.
 */
defineProps<{
  title: string
  saving?: boolean | undefined
  dirty?: boolean | undefined
  problems?: Problem[] | undefined
  saveLabel?: string | undefined
  /** Absent for a definition that has not been written yet. */
  deletable?: boolean | undefined
}>()
defineEmits<{ save: []; cancel: []; remove: [] }>()

const view = defineModel<'form' | 'yaml'>('view', { default: 'form' })
const confirmingDelete = ref(false)
</script>

<template>
  <div class="flex h-full flex-col">
    <header
      class="flex items-center gap-4 border-b border-[var(--color-line)] px-6 py-3.5"
    >
      <h1 class="text-base font-medium">{{ title }}</h1>
      <span
        v-if="dirty"
        class="font-mono text-[10px] tracking-wide text-[var(--color-warn)]"
        data-testid="dirty"
      >
        unsaved
      </span>
      <div class="ml-auto flex items-center gap-2">
        <ViewToggle v-model="view" />

        <!-- Two clicks, because a definition can be the only copy of something
             someone spent an afternoon on and there is no undo. -->
        <template v-if="deletable">
          <button
            v-if="!confirmingDelete"
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-danger)]"
            data-testid="delete"
            @click="confirmingDelete = true"
          >
            Delete
          </button>
          <button
            v-else
            type="button"
            class="rounded-md border border-[var(--color-danger)]/50 px-3 py-1.5 text-sm text-[var(--color-danger)]"
            data-testid="delete-confirm"
            @click="$emit('remove')"
          >
            Really delete?
          </button>
        </template>

        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          data-testid="cancel"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
        <button
          type="button"
          :disabled="saving"
          class="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          data-testid="save"
          @click="$emit('save')"
        >
          {{ saving ? 'Saving…' : (saveLabel ?? 'Save') }}
        </button>
      </div>
    </header>

    <div
      v-if="problems && problems.length > 0"
      class="border-b border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-6 py-2.5"
      data-testid="problems"
    >
      <p
        v-for="(problem, index) in problems"
        :key="index"
        class="value text-xs"
        :class="
          problem.severity === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-warn)]'
        "
      >
        {{ problem.field ? `${problem.field}: ` : '' }}{{ problem.message }}
      </p>
    </div>

    <slot name="conflict" />

    <!-- Side by side while editing; the file alone when you want to read it.
         The YAML side is always a view — one editor, one source of truth. -->
    <div
      v-if="view === 'form'"
      class="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    >
      <div class="overflow-auto px-6 py-4"><slot name="form" /></div>
      <slot name="preview" />
    </div>
    <div v-else class="min-h-0 flex-1"><slot name="preview" /></div>
  </div>
</template>
