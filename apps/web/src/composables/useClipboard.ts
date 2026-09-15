import { onUnmounted, ref } from 'vue'

/**
 * Copy something, and say so briefly.
 *
 * It was written twice before this — once on the setup page, once in the token
 * dictionary — and the two behaved differently: one showed "copied" inline and
 * cleared itself, the other put it in a `title` attribute and never cleared,
 * so a page that had copied anything claimed to have copied it for ever. The
 * self-clearing one is the better of the two and is the behaviour here.
 *
 * `copied` holds the text most recently copied, so a list of copyable things
 * can mark the right one rather than all of them. Compare against the value
 * rather than a boolean.
 *
 * Clipboard access can be refused — a browser without permission, an insecure
 * origin, a headless run — and that is not worth an error: everything offered
 * for copying is on screen to read. `copy` returns whether it worked, for the
 * rare caller that needs to say.
 */
export function useClipboard(options: { readonly clearAfterMs?: number } = {}) {
  const clearAfter = options.clearAfterMs ?? 1500
  const copied = ref<string | undefined>(undefined)
  let timer: ReturnType<typeof setTimeout> | undefined

  // Otherwise a page left before the timer fires writes to a ref nothing is
  // rendering, which Vue tolerates and a test runner reports as a leak.
  onUnmounted(() => clearTimeout(timer))

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      copied.value = undefined
      return false
    }
    copied.value = text
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = undefined), clearAfter)
    return true
  }

  return { copied, copy }
}
