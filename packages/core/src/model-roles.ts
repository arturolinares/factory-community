/**
 * Which model to use, as a role rather than an id.
 *
 * The indirection is the point. Provider model ids move -- GitHub retired
 * Copilot ids mid-2026 and the CLI hard-errors on a stale one -- so a phase
 * that says `model: strong` keeps working across an id change, and the map
 * from role to id lives in the provider plugin as data.
 *
 * A literal id is still accepted for the case where a phase genuinely needs
 * one specific model.
 *
 * A leaf on purpose: this file imports nothing. It used to live in
 * `builtins/steps.ts`, which `providers/descriptor.ts` then had to import — so
 * `builtins/steps → providers/capability → providers/descriptor → builtins/steps`
 * was a cycle waiting for one value import to close it. Adding
 * `permissionArgsFor` closed it, and zod failed at module init with "Cannot
 * convert undefined or null to object" from inside `z.enum` — an error that
 * names neither the cycle nor the file that caused it.
 *
 * The agent step and the provider descriptor both need this vocabulary and
 * neither owns the other, so it belongs to neither.
 */
export const MODEL_ROLES = ['strong', 'balanced', 'fast'] as const

export type ModelRole = (typeof MODEL_ROLES)[number]
