import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiError, api, type Project } from '../api/client.js'
import { live, type LiveConnection } from '../api/live.js'

/** Everything, as opposed to one project. */
export const ALL = 'all' as const
export type Selection = string | typeof ALL

const REMEMBERED = 'factory.project'

/**
 * Which project the board is about.
 *
 * Kept here rather than in the URL. Factory is a single-user local tool, the
 * rail always shows the current selection, and the board's other filters are
 * not in the URL either — putting only this one there would make it the odd
 * one out and make every internal link carry it.
 *
 * Remembered across reloads, because coming back to a board showing every
 * project's tasks when you have been working in one all morning is a small
 * lie about where you are.
 */
export const useProjects = defineStore('projects', () => {
  const items = ref<Project[]>([])
  const selected = ref<Selection>(remembered())
  const loading = ref(false)
  const error = ref<string | undefined>(undefined)

  let connection: LiveConnection | undefined

  async function load(): Promise<void> {
    loading.value = true
    error.value = undefined
    try {
      items.value = (await api.projects()).items
      // A project someone removed in another window, or on the projects page.
      // Falling back to everything is the honest answer: showing an empty
      // board filtered by something that is gone explains nothing.
      if (selected.value !== ALL && !items.value.some((p) => p.id === selected.value)) {
        select(ALL)
      }
    } catch (caught) {
      error.value = caught instanceof ApiError ? caught.message : String(caught)
    } finally {
      loading.value = false
    }
  }

  function select(next: Selection): void {
    selected.value = next
    remember(next)
  }

  function connect(): void {
    if (connection !== undefined) return
    connection = live((name) => {
      if (name.startsWith('project.')) void load()
    })
  }

  function disconnect(): void {
    connection?.close()
    connection = undefined
  }

  /** The id to send to the API, or undefined when the answer is "everything". */
  const projectId = computed(() => (selected.value === ALL ? undefined : selected.value))
  const current = computed(() => items.value.find((project) => project.id === projectId.value))

  return {
    items,
    selected,
    projectId,
    current,
    loading,
    error,
    load,
    select,
    connect,
    disconnect,
  }
})

/**
 * Storage is best-effort in both directions.
 *
 * A private window, cleared site data or a browser set to refuse it all throw
 * on access rather than returning nothing, and none of that is a reason for
 * the board not to render.
 */
function remembered(): Selection {
  try {
    return localStorage.getItem(REMEMBERED) ?? ALL
  } catch {
    return ALL
  }
}

function remember(value: Selection): void {
  try {
    localStorage.setItem(REMEMBERED, value)
  } catch {
    // Nothing to do about it, and nothing worth telling anyone.
  }
}
