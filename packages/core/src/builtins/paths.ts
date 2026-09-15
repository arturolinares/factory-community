import { fileURLToPath } from 'node:url'

/**
 * Where the definitions Factory ships with live.
 *
 * Located relative to this module, not by climbing from the process's working
 * directory. xfactory computed its root as `join(__dirname, '../../../..')`,
 * which is meaningless under a global install, a pnpm store layout, or a
 * bundled binary — and it silently disagreed with the other anchor it used
 * everywhere else. A package finding its own files is the only form that
 * survives packaging.
 *
 * A function rather than a constant so nothing is frozen at import time.
 */
export function builtinScopeRoot(): string {
  // src/builtins/ -> package root, and dist/builtins/ -> package root too.
  return fileURLToPath(new URL('../../builtin', import.meta.url))
}

/**
 * Where the examples live.
 *
 * Examples are bundles, not definitions: they are imported, read and edited,
 * and a pipeline that runs `npm test` has no business resolving for a Rust
 * repository the way a built-in would. Shipping them in the format the sharing
 * feature already uses means one loader, one validator and one import path.
 */
export function examplesRoot(): string {
  return fileURLToPath(new URL('../../examples', import.meta.url))
}
