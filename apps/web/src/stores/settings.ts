import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiError, api, type FactorySettings } from '../api/client.js'

/**
 * What the person using Factory has chosen.
 *
 * Held by the daemon rather than in this browser, so the desktop app and a tab
 * pointed at the same daemon agree, and so the CLI can honour the same
 * switches. `localStorage` would have been simpler and would have made the app
 * and the browser disagree about the same installation.
 */
export const MAX_SCALE = 3

/** Every size the control offers. 1 is what the board was designed at. */
export const SCALES: readonly number[] = [1, 1.25, 1.5, 2, 2.5, 3]

export const useSettings = defineStore('settings', () => {
  const settings = ref<FactorySettings | undefined>(undefined)
  const file = ref<string | undefined>(undefined)
  const loading = ref(false)
  const error = ref<string | undefined>(undefined)

  const scale = computed(() => settings.value?.ui.scale ?? 1)

  /**
   * Apply the size the way Cmd+ applies it.
   *
   * `zoom` rather than a root `font-size`, because the board has a hundred
   * hard-coded pixel text sizes in its mono badges and labels: a font-size
   * would grow the body text and leave the metadata layer behind. `zoom`
   * scales px and rem alike, which is what "what happens when I press command
   * and plus" actually means.
   */
  const apply = (value: number): void => {
    const root = document.documentElement
    root.style.zoom = value === 1 ? '' : String(value)
    // Told to the stylesheet as well, because `100vh` is measured in unzoomed
    // pixels: the shell divides by this so "full height" keeps meaning the
    // window rather than a multiple of it.
    root.style.setProperty('--app-zoom', String(value))
  }

  async function load(): Promise<void> {
    loading.value = true
    try {
      const answer = await api.settings()
      settings.value = answer.settings
      file.value = answer.file
      apply(answer.settings.ui.scale)
      error.value = undefined
    } catch (caught) {
      error.value = caught instanceof ApiError ? caught.message : String(caught)
    } finally {
      loading.value = false
    }
  }

  async function setScale(value: number): Promise<void> {
    // Applied before the round trip, so dragging feels immediate; the answer
    // is still the daemon's, and a refusal puts it back.
    apply(value)
    try {
      const answer = await api.saveSettings({ ui: { scale: value } })
      settings.value = answer.settings
      error.value = undefined
    } catch (caught) {
      error.value = caught instanceof ApiError ? caught.message : String(caught)
      apply(scale.value)
    }
  }

  return { settings, file, loading, error, scale, load, setScale }
})
