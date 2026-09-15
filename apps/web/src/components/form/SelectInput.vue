<script setup lang="ts">
/**
 * One of a closed set.
 *
 * Shares `.field-control` with `ComboInput`, and monospace with every other
 * value that ends up in a YAML file — `approval: none` and `uses: agent` are
 * as much file content as a path or a command.
 */
defineProps<{
  modelValue: string
  options: readonly string[]
  id?: string | undefined
  allowEmpty?: boolean | undefined
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <select
    :id="id"
    :value="modelValue"
    class="value field-control"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-if="allowEmpty" value="">—</option>
    <option v-for="option in options" :key="option" :value="option">{{ option }}</option>
  </select>
</template>
