<script setup lang="ts">
import { onMounted } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { SCALES, useSettings } from '../stores/settings.js'

/**
 * Preferences, kept in a file Factory owns.
 *
 * Not in `config.yaml`, which is hand-written and full of the author's
 * comments, and not in the database, which lives in the default write scope
 * and is therefore per-repository rather than per-person.
 */
const settings = useSettings()

onMounted(() => {
  if (settings.settings === undefined) void settings.load()
})
</script>

<template>
  <PageHeader title="Settings" subtitle="Preferences, kept beside your definitions." />

  <div class="space-y-8 px-8 py-6">
    <p
      v-if="settings.error"
      class="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-danger)]"
      data-testid="error"
    >
      {{ settings.error }}
    </p>

    <section data-testid="appearance">
      <h2 class="mb-3 font-mono text-[11px] tracking-widest text-[var(--color-ink-faint)] uppercase">
        Interface size
      </h2>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="value in SCALES"
          :key="value"
          type="button"
          class="rounded-md border px-3 py-1.5 text-sm"
          :class="
            settings.scale === value
              ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
              : 'border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          "
          :data-testid="`scale-${value}`"
          @click="settings.setScale(value)"
        >
          {{ value }}×
        </button>
      </div>
      <!-- The same thing Cmd+ does, which is what was asked for — and why it
           is page zoom rather than a font size: the board has a hundred
           hard-coded pixel sizes in its badges that a font-size would leave
           behind. -->
      <p class="mt-2 text-xs text-[var(--color-ink-faint)]">
        Scales everything, the way ⌘+ does. Saved for this installation, so the
        app and a browser agree.
      </p>
    </section>

    <section v-if="settings.file" data-testid="settings-file">
      <h2 class="mb-2 font-mono text-[11px] tracking-widest text-[var(--color-ink-faint)] uppercase">
        Where this is kept
      </h2>
      <p class="font-mono text-[11px] text-[var(--color-ink-muted)]">{{ settings.file }}</p>
    </section>
  </div>
</template>
