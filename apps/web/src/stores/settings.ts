import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  ApiError,
  api,
  type Disclaimer,
  type ExecutionProfile,
  type FactorySettings,
} from '../api/client.js'

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
  /** The wording to show, served with the settings so there is only one of it. */
  const disclaimer = ref<Disclaimer | undefined>(undefined)
  /**
   * Whether this installation has accepted it.
   *
   * Served rather than derived from the version number, because deciding
   * whether a stored 1 satisfies a current 2 is the daemon's arithmetic and a
   * second copy of it here would be the copy that goes stale.
   *
   * `undefined` until the first load, which is not the same as `false`: the
   * board must not flash a disclaimer at somebody who has already accepted it.
   */
  const accepted = ref<boolean | undefined>(undefined)

  // Optional all the way down, including *inside* a settings object that
  // exists. A board served by an older daemon gets a settings object with no
  // `security` group at all — which is exactly what happened the first time
  // this ran, and `settings.value?.security.profile` threw and took the whole
  // component update with it. Degrade by absence applies to a payload as much
  // as to a capability.
  const scale = computed(() => settings.value?.ui?.scale ?? 1)
  const profile = computed<ExecutionProfile>(() => settings.value?.security?.profile ?? 'default')
  /** Whether to draw the Full Access marker. Read by the shell on every page. */
  const unconfined = computed(() => profile.value === 'full-access')

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
      disclaimer.value = answer.disclaimer
      accepted.value = answer.accepted
      // Through the guarded computed, so an older payload with no ui group
      // falls back to 1 rather than throwing here.
      apply(answer.settings.ui?.scale ?? 1)
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

  /**
   * Record that the disclaimer has been read.
   *
   * No argument: the version stored is the daemon's own, so a board showing an
   * older copy cannot accept on behalf of a newer one.
   */
  async function accept(): Promise<boolean> {
    try {
      const answer = await api.acceptDisclaimer()
      settings.value = answer.settings
      accepted.value = answer.accepted
      error.value = undefined
      return true
    } catch (caught) {
      error.value = caught instanceof ApiError ? caught.message : String(caught)
      return false
    }
  }

  async function setProfile(value: ExecutionProfile): Promise<void> {
    try {
      const answer = await api.saveSettings({ security: { profile: value } })
      settings.value = answer.settings
      error.value = undefined
    } catch (caught) {
      error.value = caught instanceof ApiError ? caught.message : String(caught)
    }
  }

  /**
   * Notice that a run was refused for want of an acceptance.
   *
   * Called by whatever caught the refusal, so the panel appears wherever
   * somebody pressed the button rather than only where they happened to reload.
   * The daemon is the gate; this is the board catching up with it.
   */
  function refusedForAcceptance(): void {
    accepted.value = false
  }

  return {
    settings,
    file,
    loading,
    error,
    scale,
    profile,
    unconfined,
    disclaimer,
    accepted,
    load,
    setScale,
    setProfile,
    accept,
    refusedForAcceptance,
  }
})
