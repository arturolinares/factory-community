<script setup lang="ts">
/**
 * A text box that offers values without insisting on them.
 *
 * For fields with a well-known set that is not closed — a model is `strong`,
 * `balanced`, `fast` or any literal id the provider accepts. A `<select>` would
 * make the common case easy and the real one impossible; a plain text box makes
 * both equally hard.
 *
 * Deliberately indistinguishable from `SelectInput`: the difference between
 * them is whether a value outside the list is allowed, and that is not
 * something a person should have to infer from the shape of the control.
 */
const props = defineProps<{
  modelValue: string
  options: readonly string[]
  id?: string | undefined
  placeholder?: string | undefined
  /**
   * Bound explicitly, not inherited.
   *
   * This component has two root nodes — the input and its datalist — so Vue
   * cannot decide which one a fallthrough attribute belongs on, and silently
   * applies it to neither. The options get their own hook, because "what does
   * this field offer" is a question about the list, not the box.
   */
  testid?: string | undefined
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()

// A datalist is matched by id, so two comboboxes on one page must not share one.
const listId = `combo-${Math.random().toString(36).slice(2, 10)}`
</script>

<template>
  <input
    :id="id"
    :value="modelValue"
    :list="listId"
    :placeholder="placeholder"
    :data-testid="props.testid"
    type="text"
    class="value field-control"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
  <datalist :id="listId" :data-testid="props.testid ? `${props.testid}-options` : undefined">
    <option v-for="option in options" :key="option" :value="option" />
  </datalist>
</template>
