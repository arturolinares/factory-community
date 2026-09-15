<script setup lang="ts">
defineProps<{
  modelValue: string
  placeholder?: string | undefined
  id?: string | undefined
  mono?: boolean | undefined
  /**
   * Declared, not inherited.
   *
   * The template sets `type` itself, so a fallthrough `type="number"` is
   * arguing with it — and which one wins is exactly the kind of thing nobody
   * should have to look up. `min`/`max` are not set here, so those still fall
   * through as ordinary attributes.
   */
  type?: 'text' | 'number' | undefined
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <input
    :id="id"
    :value="modelValue"
    :placeholder="placeholder"
    :type="type ?? 'text'"
    :class="[
      'w-full rounded-md border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-1.5 text-sm',
      'text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]',
      'focus:border-[var(--color-accent)] focus:outline-none',
      mono ? 'value' : '',
    ]"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
