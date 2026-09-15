/**
 * Hand a file to the browser.
 *
 * A bundle is meant to leave the machine — attached to a pull request, pasted
 * into a chat — so the export has to produce an actual file rather than text on
 * a page someone has to select and copy.
 */
export function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/yaml' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked on the next tick rather than immediately: some browsers have not
  // started reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
