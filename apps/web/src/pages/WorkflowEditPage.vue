<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Definition, type DefinitionListing } from '../api/client.js'
import { useEditor } from '../composables/useEditor.js'
import { useProjects } from '../stores/projects.js'
import EditorLayout from '../components/form/EditorLayout.vue'
import YamlPreview from '../components/form/YamlPreview.vue'
import ScopeSelector from '../components/form/ScopeSelector.vue'
import FieldRow from '../components/form/FieldRow.vue'
import TextInput from '../components/form/TextInput.vue'
import SelectInput from '../components/form/SelectInput.vue'
import StringListEditor from '../components/form/StringListEditor.vue'
import PhaseListEditor from '../components/form/PhaseListEditor.vue'
import ConflictPanel from '../components/form/ConflictPanel.vue'
import VariablesEditor from '../components/form/VariablesEditor.vue'

const route = useRoute()
const router = useRouter()
const name = computed(() => route.params.name as string | undefined)

const blank = (): Definition => ({
  name: '',
  mode: 'once',
  scheduling: 'parallel',
  description: '',
  variables: {},
  phases: [],
  extensions: {},
})

const chosen = useProjects()
const editor = useEditor('workflow', blank)
const view = ref<'form' | 'yaml'>('form')
const availablePhases = ref<DefinitionListing[]>([])
const availableWorkflows = ref<DefinitionListing[]>([])

const field = <T,>(key: string, fallback: T) =>
  computed({
    get: () => (editor.definition.value[key] as T | undefined) ?? fallback,
    set: (value: T) => {
      editor.definition.value = { ...editor.definition.value, [key]: value }
    },
  })

const nameField = field('name', '')
const description = field('description', '')
const mode = field('mode', 'once')
const scheduling = field('scheduling', 'parallel')
const phases = field<string[]>('phases', [])
const variables = field<Record<string, string>>('variables', {})

const interval = computed({
  get: () => String(editor.definition.value.interval ?? ''),
  set: (value: string) => {
    const next = { ...editor.definition.value }
    if (value === '') delete next.interval
    else next.interval = Number(value)
    editor.definition.value = next
  },
})

/**
 * How many times a loop runs. Clamped rather than merely validated.
 *
 * The schema refuses anything outside 1..100, but a form that lets you type 0
 * and then tells you off on save is a form that wasted your time — so the box
 * carries the same bounds and a value outside them is brought back in.
 */
const repeat = computed({
  get: () => String(editor.definition.value.repeat ?? ''),
  set: (value: string) => {
    const next = { ...editor.definition.value }
    if (value.trim() === '') delete next.repeat
    else {
      const wanted = Number(value)
      // Not a number at all is not a decision — leave what was there.
      if (!Number.isFinite(wanted)) return
      next.repeat = Math.min(100, Math.max(1, Math.round(wanted)))
    }
    editor.definition.value = next
  },
})

const onFail = computed({
  get: () => (editor.definition.value.onFail as string | undefined) ?? '',
  set: (value: string) => {
    const next = { ...editor.definition.value }
    if (value === '') delete next.onFail
    else next.onFail = value
    editor.definition.value = next
  },
})

const requires = computed({
  get: () =>
    ((editor.definition.value.conditions as { requires?: string[] } | undefined)?.requires ?? []),
  set: (value: string[]) => {
    const next = { ...editor.definition.value }
    // An empty conditions block is noise in the file; absence says the same
    // thing and reads better.
    if (value.length === 0) delete next.conditions
    else next.conditions = { requires: value }
    editor.definition.value = next
  },
})

onMounted(async () => {
  await editor.load(name.value)
  availablePhases.value = (await api.list('phase', chosen.projectId)).items
  availableWorkflows.value = (await api.list('workflow', chosen.projectId)).items
})
</script>

<template>
  <EditorLayout
    :title="name ? `Workflow · ${name}` : 'New workflow'"
    :saving="editor.saving.value"
    :dirty="editor.dirty.value"
    :problems="editor.problems.value"
    :save-label="editor.saveLabel.value"
    :deletable="!editor.isNew.value"
    v-model:view="view"
    @save="editor.save()"
    @remove="editor.remove()"
    @cancel="router.push('/workflows')"
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
        <!-- Said before the save, not after: writing here quietly changes which
             file runs, and that is invisible unless someone says so. -->
        <p
          v-if="editor.willShadow.value.length > 0"
          class="mt-2 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 px-3 py-2 text-xs text-[var(--color-warn)]"
          data-testid="will-shadow"
        >
          Saving here will hide the
          {{ editor.willShadow.value.map((ref) => ref.scope).join(', ') }} copy.
        </p>
      </FieldRow>

      <FieldRow label="Name" for="wf-name">
        <TextInput id="wf-name" v-model="nameField" mono placeholder="development" />
      </FieldRow>

      <FieldRow label="Description" for="wf-description">
        <TextInput id="wf-description" v-model="description" placeholder="What this does." />
      </FieldRow>

      <FieldRow
        label="Mode"
        for="wf-mode"
        hint="A loop restarts from the first phase after the last one."
      >
        <SelectInput id="wf-mode" v-model="mode" :options="['once', 'loop']" />
      </FieldRow>

      <!-- Only meaningful for a loop, and the schema rejects it otherwise, so
           it does not exist here otherwise either. -->
      <FieldRow
        v-if="mode === 'loop'"
        label="Interval"
        for="wf-interval"
        hint="Seconds between iterations."
      >
        <TextInput id="wf-interval" v-model="interval" mono placeholder="30" />
      </FieldRow>

      <FieldRow
        v-if="mode === 'loop'"
        label="Repeat"
        for="wf-repeat"
        hint="How many times it runs, 1 to 100. Leave empty to keep going until you stop it."
      >
        <TextInput
          id="wf-repeat"
          v-model="repeat"
          mono
          type="number"
          min="1"
          max="100"
          placeholder="10"
          data-testid="wf-repeat"
        />
      </FieldRow>

      <FieldRow
        label="Scheduling"
        for="wf-scheduling"
        hint="How this workflow is scheduled against other tasks — not against its own phases, which always run in order."
      >
        <SelectInput id="wf-scheduling" v-model="scheduling" :options="['parallel', 'sequential']" />
      </FieldRow>

      <FieldRow label="Phases" hint="Run in this order.">
        <PhaseListEditor v-model="phases" :available="availablePhases" />
      </FieldRow>

      <FieldRow label="On fail" for="wf-onfail" hint="Queued when a step fails.">
        <SelectInput
          id="wf-onfail"
          v-model="onFail"
          :options="availableWorkflows.map((item) => item.name)"
          allow-empty
        />
      </FieldRow>

      <FieldRow label="Requires" hint="Flags that must hold before this runs.">
        <StringListEditor v-model="requires" testid="requires" placeholder="hasWorktree" />
      </FieldRow>

      <FieldRow label="Variables">
        <VariablesEditor v-model="variables" />
      </FieldRow>
    </template>

    <template #preview>
      <YamlPreview :text="editor.preview.value" :stale="editor.previewPending.value" />
    </template>
  </EditorLayout>
</template>
