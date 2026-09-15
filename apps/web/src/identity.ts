/**
 * What a project looks like, worked out from its name.
 *
 * Two letters and a colour, and both are a pure function of the name — so the
 * rail, the projects list and anything added later agree without being told,
 * a new project needs no decision from anyone, and nothing has to be stored or
 * migrated. The cost is that renaming a project changes its colour, which is
 * the right trade: a rename is rare and deliberate, while picking a colour for
 * every project is a chore on every single one.
 */

/** How many hues `--color-project-N` defines. */
export const PROJECT_TONES = 6

/**
 * One or two letters for the square.
 *
 * Words first — "todo list" is TL, which is what a person would write. A
 * single word gives its first two letters rather than one, because one letter
 * collides far too easily across a handful of projects.
 */
export function initials(name: string): string {
  const words = name.split(/[\s_\-/.]+/u).filter((word) => word !== '')
  if (words.length === 0) return '??'
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase()
  return `${(words[0] as string)[0] ?? ''}${(words[1] as string)[0] ?? ''}`.toUpperCase()
}

/**
 * Which of the project hues this name gets: 1 to PROJECT_TONES.
 *
 * A plain string hash. Two projects can land on the same hue — with six
 * colours that is unavoidable and not worth solving with bookkeeping, because
 * the initials are what actually identify the square. What matters is that the
 * answer never changes between page loads.
 */
export function tone(name: string): number {
  let hash = 0
  for (const character of name) {
    hash = (hash * 31 + character.codePointAt(0)!) % 1_000_003
  }
  return (hash % PROJECT_TONES) + 1
}

/** The CSS variable holding this project's hue. */
export const toneVariable = (name: string): string => `var(--color-project-${tone(name)})`
