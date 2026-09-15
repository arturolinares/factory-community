<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, type ScopesResponse } from '../api/client.js'
import { useProjects } from '../stores/projects.js'
import PageHeader from '../components/PageHeader.vue'
import ScopeBadge from '../components/ScopeBadge.vue'

/**
 * Where definitions are read from, in order.
 *
 * The paths are shown in full and in monospace on purpose. Path opacity was the
 * original problem — the prototype computed them from two disagreeing anchors —
 * so the answer to "where is this actually reading from" should never require
 * running a command.
 */
const data = ref<ScopesResponse | undefined>(undefined)
const error = ref<string | undefined>(undefined)
const chosen = useProjects()

// With a project selected this is that project's chain, which is the whole
// question the page answers: where its definitions come from, and where a
// write would land.
async function load(): Promise<void> {
  try {
    data.value = await api.scopes(chosen.projectId)
    error.value = undefined
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

onMounted(load)
watch(() => chosen.projectId, load)
</script>

<template>
  <PageHeader
    title="Scopes"
    :subtitle="
      chosen.current
        ? `Where ${chosen.current.name}'s definitions are read from, highest precedence first.`
        : 'Where definitions are read from, highest precedence first.'
    "
  />

  <div class="px-8 py-6">
    <div
      v-if="error"
      class="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-danger)]"
      data-testid="error"
    >
      {{ error }}
    </div>

    <ol v-else class="space-y-2" data-testid="scope-chain">
      <li
        v-for="scope in data?.scopes ?? []"
        :key="scope.kind"
        class="flex items-center gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3"
        :data-testid="`scope-row-${scope.kind}`"
      >
        <ScopeBadge :scope="scope.kind" />
        <span class="value text-[var(--color-ink-muted)]">{{ scope.root }}</span>
        <span class="ml-auto flex gap-3 font-mono text-[10px] text-[var(--color-ink-faint)]">
          <span>{{ scope.exists ? 'present' : 'absent' }}</span>
          <span>{{ scope.writable ? 'writable' : 'read-only' }}</span>
        </span>
      </li>
    </ol>

    <p v-if="data" class="mt-4 text-sm text-[var(--color-ink-muted)]" data-testid="write-target">
      New definitions are written to the
      <span class="value text-[var(--color-ink)]">{{ data.defaultWriteScope }}</span> scope.
    </p>
  </div>
</template>
