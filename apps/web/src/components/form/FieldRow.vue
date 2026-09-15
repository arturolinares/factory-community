<script setup lang="ts">
// Optional props accept an explicit `undefined` because that is what a Vue
// template binds when a value is absent, and `exactOptionalPropertyTypes`
// distinguishes "missing" from "present and undefined".
defineProps<{ label: string; hint?: string | undefined; for?: string | undefined }>()
</script>

<template>
  <div class="grid grid-cols-[9rem_1fr] items-start gap-4 py-2">
    <label
      :for="$props.for"
      class="pt-1.5 font-mono text-[10px] tracking-widest text-[var(--color-ink-faint)] uppercase"
    >
      {{ label }}
    </label>
    <div class="min-w-0">
      <slot />
      <p v-if="hint" class="mt-1 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        {{ hint }}
      </p>
    </div>
  </div>
</template>
