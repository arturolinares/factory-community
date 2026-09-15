<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Definition, type ProviderEntry } from '../api/client.js'
import { useEditor } from '../composables/useEditor.js'
import EditorLayout from '../components/form/EditorLayout.vue'
import YamlPreview from '../components/form/YamlPreview.vue'
import ScopeSelector from '../components/form/ScopeSelector.vue'
import FieldRow from '../components/form/FieldRow.vue'
import TextInput from '../components/form/TextInput.vue'
import SelectInput from '../components/form/SelectInput.vue'
import ComboInput from '../components/form/ComboInput.vue'
import StringListEditor from '../components/form/StringListEditor.vue'
import ConflictPanel from '../components/form/ConflictPanel.vue'

/**
 * An agent: the settings a step would otherwise spell out every time.
 *
 * Every bounded field here is a control over the real set rather than a text
 * box — which providers are installed, which model roles exist, which effort
 * levels the chosen provider actually understands. Typing `clade` and finding
 * out when the run fails is the failure this page exists to remove.
 */
const route = useRoute()
const router = useRouter()
const name = computed(() => route.params.name as string | undefined)

const blank = (): Definition => ({
  name: '',
  description: '',
  extensions: {},
})

const editor = useEditor('agent', blank)
const view = ref<'form' | 'yaml'>('form')
const providers = ref<ProviderEntry[]>([])

const field = <T,>(key: string, fallback: T) =>
  computed({
    get: () => (editor.definition.value[key] as T | undefined) ?? fallback,
    set: (value: T) => {
      editor.definition.value = { ...editor.definition.value, [key]: value }
    },
  })

const optional = (key: string) =>
  computed({
    get: () => (editor.definition.value[key] as string | undefined) ?? '',
    set: (value: string) => {
      const next = { ...editor.definition.value }
      if (value === '') delete next[key]
      else next[key] = value
      editor.definition.value = next
    },
  })

const nameField = field('name', '')
const description = field('description', '')
const provider = optional('provider')
const model = optional('model')
const effort = optional('effort')
const subagent = optional('subagent')
const session = optional('session')
const args = field<string[]>('args', [])

const providerIds = computed(() => providers.value.map((entry) => entry.id))
const chosen = computed(() => providers.value.find((entry) => entry.id === provider.value))

/**
 * Roles first, then the concrete ids this provider maps them to.
 *
 * A role keeps a phase working across a model rename, which is why it is
 * offered first — but a literal id is explicitly supported, so this is a
 * combobox and not a closed list.
 */
const modelOptions = computed(() => [
  'strong',
  'balanced',
  'fast',
  ...Object.values(chosen.value?.models ?? {}).filter((id): id is string => typeof id === 'string'),
])

/** Only what the chosen provider says it understands. Empty means it has none. */
const effortOptions = computed(() => chosen.value?.effortValues ?? [])

onMounted(async () => {
  await editor.load(name.value)
  providers.value = (await api.providers()).items
})
</script>

<template>
  <EditorLayout
    :title="name ? `Agent · ${name}` : 'New agent'"
    :saving="editor.saving.value"
    :dirty="editor.dirty.value"
    :problems="editor.problems.value"
    :save-label="editor.saveLabel.value"
    :deletable="!editor.isNew.value"
    v-model:view="view"
    @save="editor.save()"
    @remove="editor.remove()"
    @cancel="router.push('/agents')"
  >
    <template #conflict>
      <ConflictPanel
        v-if="editor.conflict.value"
        :raw="editor.conflict.value.raw"
        @reload="editor.reload()"
        @overwrite="editor.overwrite()"
      />
    </template>

    <template #form>
      <FieldRow label="Scope">
        <ScopeSelector
          v-model="editor.targetScope.value"
          :scopes="editor.scopes.value"
          :origin="editor.origin.value"
          @fork="editor.fork()"
        />
        <p
          v-if="editor.willShadow.value.length > 0"
          class="mt-2 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 px-3 py-2 text-xs text-[var(--color-warn)]"
          data-testid="will-shadow"
        >
          Saving here will hide the
          {{ editor.willShadow.value.map((ref) => ref.scope).join(', ') }} copy.
        </p>
      </FieldRow>

      <FieldRow label="Name" for="ag-name">
        <TextInput id="ag-name" v-model="nameField" mono placeholder="developer" />
      </FieldRow>

      <FieldRow label="Description" for="ag-description">
        <TextInput id="ag-description" v-model="description" placeholder="Writes the code." />
      </FieldRow>

      <FieldRow
        label="Provider"
        for="ag-provider"
        hint="Leave empty to use whichever agent the installation is configured with."
      >
        <SelectInput
          id="ag-provider"
          v-model="provider"
          :options="providerIds"
          allow-empty
          data-testid="agent-provider"
        />
        <p
          v-if="chosen && !chosen.available"
          class="mt-1 text-xs text-[var(--color-warn)]"
          data-testid="provider-unavailable"
        >
          {{ chosen.displayName }} is installed as a plugin but its command was not found, so this
          agent will not run until it is.
        </p>
      </FieldRow>

      <FieldRow
        label="Model"
        for="ag-model"
        hint="A role — strong, balanced, fast — which survives a model rename, or a literal id."
      >
        <ComboInput
          id="ag-model"
          v-model="model"
          :options="modelOptions"
          placeholder="strong"
          testid="agent-model"
        />
      </FieldRow>

      <FieldRow
        label="Effort"
        for="ag-effort"
        :hint="
          effortOptions.length === 0
            ? 'The chosen provider does not take an effort setting, so this would be ignored.'
            : 'How hard it should think.'
        "
      >
        <SelectInput
          id="ag-effort"
          v-model="effort"
          :options="effortOptions"
          allow-empty
          data-testid="agent-effort"
        />
      </FieldRow>

      <FieldRow
        label="Subagent"
        for="ag-subagent"
        hint="A named persona, mapped per provider. Open-ended — whatever your provider knows."
      >
        <TextInput id="ag-subagent" v-model="subagent" mono placeholder="implementer" />
      </FieldRow>

      <FieldRow
        label="Session"
        for="ag-session"
        hint="How much context it carries between steps."
      >
        <SelectInput
          id="ag-session"
          v-model="session"
          :options="['task', 'workflow', 'phase', 'none']"
          allow-empty
          data-testid="agent-session"
        />
      </FieldRow>

      <FieldRow label="Arguments" hint="Appended verbatim to the rendered command.">
        <StringListEditor v-model="args" placeholder="--verbose" testid="agent-args" />
      </FieldRow>
    </template>

    <template #preview>
      <YamlPreview :text="editor.preview.value" :stale="editor.previewPending.value" />
    </template>
  </EditorLayout>
</template>
