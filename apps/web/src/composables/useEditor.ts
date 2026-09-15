import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  ApiError,
  api,
  type Definition,
  type DefinitionKind,
  type DefinitionRef,
  type Problem,
  type Scope,
  type ScopeKind,
} from '../api/client.js'
import { useProjects } from '../stores/projects.js'

/**
 * The load/preview/save cycle both editors share.
 *
 * The etag handling is the part worth reading. A save sends back the hash of
 * the bytes that were loaded; if the file has changed underneath — someone
 * editing it in a terminal, another tab, a git checkout — the daemon refuses
 * and returns what is actually there. Overwriting silently would lose work
 * that Factory never saw.
 */
export function useEditor(kind: DefinitionKind, blank: () => Definition) {
  const router = useRouter()
  // Definitions live in a scope chain and the rail says whose. Reading, writing
  // and deleting all have to agree about that, or a workflow opened from a
  // project's list is saved back into the daemon's own scope instead.
  const chosen = useProjects()

  const definition = ref<Definition>(blank())
  const scopes = ref<Scope[]>([])
  const targetScope = ref<ScopeKind>('project')
  const origin = ref<ScopeKind | undefined>(undefined)
  const shadows = ref<DefinitionRef[]>([])
  const etag = ref<string | undefined>(undefined)
  const isNew = ref(true)

  const preview = ref('')
  const previewPending = ref(false)

  /**
   * Preview and save report separately.
   *
   * They used to share one list, which produced a genuinely bad moment: click
   * Save on an invalid name, see the error appear, and watch it vanish a
   * fraction of a second later when the debounced preview came back clean and
   * reset the list. Two different concerns — one describes the document, the
   * other describes the attempt to write it — so they get two slots, and a save
   * failure is never overwritten by a background refresh.
   */
  const previewProblems = ref<Problem[]>([])
  const saveProblems = ref<Problem[]>([])
  const problems = computed(() =>
    saveProblems.value.length > 0 ? saveProblems.value : previewProblems.value,
  )
  const saving = ref(false)
  const dirty = ref(false)
  const conflict = ref<{ raw: string } | undefined>(undefined)
  const deleted = ref<{ nowResolvesFrom?: DefinitionRef } | undefined>(undefined)

  /** Saving into a scope other than the one it came from is a copy, not a move. */
  const saveLabel = computed(() =>
    !isNew.value && origin.value !== undefined && origin.value !== targetScope.value
      ? `Save copy to ${targetScope.value}`
      : 'Save',
  )

  /** Names already in a lower-precedence scope would be hidden by this save. */
  const willShadow = computed(() =>
    shadows.value.filter((ref) => ref.scope !== targetScope.value),
  )

  /**
   * Look up what a name already resolves to.
   *
   * Needed for a *new* definition as much as an existing one: typing a name
   * that a lower scope already has is exactly when someone should be told, and
   * before the save rather than after. A 404 here is the ordinary case — the
   * name is free — not an error worth showing.
   */
  async function checkShadowing(name: string): Promise<void> {
    if (name.trim() === '') {
      shadows.value = []
      return
    }
    try {
      const found = await api.get(kind, name, chosen.projectId)
      shadows.value =
        found.ref.scope === targetScope.value ? found.shadows : [found.ref, ...found.shadows]
    } catch {
      shadows.value = []
    }
  }

  async function load(name?: string): Promise<void> {
    const chain = await api.scopes(chosen.projectId)
    scopes.value = chain.scopes
    targetScope.value = chain.defaultWriteScope

    if (name === undefined) {
      isNew.value = true
      return
    }
    const fetched = await api.get(kind, name, chosen.projectId)
    definition.value = fetched.definition
    etag.value = fetched.etag
    origin.value = fetched.ref.scope
    shadows.value = fetched.shadows
    isNew.value = false
    // Editing a built-in edits nothing: it is read-only, so the only sensible
    // target is somewhere writable, and Fork makes that explicit.
    targetScope.value = fetched.ref.scope === 'builtin' ? chain.defaultWriteScope : fetched.ref.scope
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    definition,
    () => {
      dirty.value = true
      previewPending.value = true
      clearTimeout(timer)
      // Debounced: the preview comes from the daemon, so a keystroke should not
      // be a request. 120ms is below the threshold where typing feels laggy.
      timer = setTimeout(async () => {
        if (isNew.value) await checkShadowing(String(definition.value.name ?? ''))
        try {
          preview.value = (await api.preview(kind, definition.value)).text
          previewProblems.value = []
        } catch (caught) {
          if (caught instanceof ApiError) {
            previewProblems.value =
              caught.problems.length > 0
                ? caught.problems
                : [{ severity: 'error', message: caught.message }]
          }
        } finally {
          previewPending.value = false
        }
      }, 120)
    },
    { deep: true, immediate: true },
  )

  /**
   * Save again, ignoring what is on disk.
   *
   * Only reachable from the conflict panel, where someone has seen the other
   * version and decided. Re-reading the current etag rather than sending a
   * blank one keeps the daemon's check intact — this is a deliberate overwrite,
   * not a way to switch it off.
   */
  async function overwrite(): Promise<void> {
    const current = await api.get(kind, String(definition.value.name), chosen.projectId)
    etag.value = current.etag
    conflict.value = undefined
    await save()
  }

  /** Take what is on disk and lose the local edits. */
  async function reload(): Promise<void> {
    conflict.value = undefined
    saveProblems.value = []
    await load(String(definition.value.name))
    dirty.value = false
  }

  async function remove(): Promise<void> {
    saving.value = true
    saveProblems.value = []
    try {
      const name = String(definition.value.name)
      const result = await api.remove(kind, name, targetScope.value, chosen.projectId)
      // Marks the editor as settled, which is what stops the route-leave guard
      // asking to save a file that is no longer there.
      deleted.value = { ...(result.nowResolvesFrom ? { nowResolvesFrom: result.nowResolvesFrom } : {}) }
      dirty.value = false

      // Straight back to the list. An editor for a definition that does not
      // exist has nothing to edit, and leaving it on screen behind a "deleted"
      // banner meant every delete ended with a second click to go somewhere
      // that was the only place left to go.
      //
      // The one thing worth carrying: deleting one copy can *reveal* a copy in
      // a lower scope, so the name still resolves — to something else. That is
      // baffling in silence, so it travels as a query and the list says it.
      await router.push({
        path: `/${kind}s`,
        query: {
          deleted: name,
          ...(result.nowResolvesFrom === undefined
            ? {}
            : { revealed: result.nowResolvesFrom.scope }),
        },
      })
    } catch (caught) {
      if (caught instanceof ApiError) {
        saveProblems.value = [{ severity: 'error', message: caught.message }]
      }
    } finally {
      saving.value = false
    }
  }

  async function save(): Promise<void> {
    saving.value = true
    saveProblems.value = []
    conflict.value = undefined
    try {
      if (isNew.value || origin.value !== targetScope.value) {
        await api.create(kind, definition.value, targetScope.value, chosen.projectId)
      } else {
        await api.update(kind, definition.value, targetScope.value, etag.value ?? '', chosen.projectId)
      }
      dirty.value = false
      await router.push(`/${kind}s`)
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 409) {
          const body = caught.body as { raw?: string } | undefined
          conflict.value = { raw: body?.raw ?? '' }
        }
        saveProblems.value =
          caught.problems.length > 0
            ? caught.problems
            : [{ severity: 'error', message: caught.message }]
      }
    } finally {
      saving.value = false
    }
  }

  /**
   * Don't lose work to a stray click on the nav.
   *
   * Only while there are unsaved changes, and never after a save or a delete —
   * a confirm dialog that fires when nothing is at stake is one people learn to
   * dismiss without reading, which defeats the point of having it.
   */
  onBeforeRouteLeave(() => {
    if (!dirty.value || deleted.value !== undefined) return true
    return window.confirm('You have unsaved changes. Leave without saving?')
  })

  function fork(): void {
    // A fork keeps the content and drops the identity of the built-in file, so
    // the next save creates rather than tries to write into the package.
    origin.value = undefined
    etag.value = undefined
    isNew.value = true
  }

  return {
    definition, scopes, targetScope, origin, shadows, willShadow,
    preview, previewPending, problems, saving, dirty, conflict, deleted,
    isNew, saveLabel, load, save, fork, remove, overwrite, reload,
  }
}
