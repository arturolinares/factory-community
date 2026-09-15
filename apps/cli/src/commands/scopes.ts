import { mkdirSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFINITION_DIRECTORIES,
  SCOPE_CONFIG_FILE,
  SCOPE_DIR,
  type ScopeKind,
} from '@factory/config'
import { IGNORED_BY_PRODUCT } from '@factory/core'
import { columns, type Style } from '../render.js'
import { failed, ok, type CliContext, type CommandResult } from '../context.js'

/** `factory config path` — where Factory is reading from, in order. */
export function configPath(context: CliContext, style: Style): CommandResult {
  const rows = context.chain.scopes.map((scope) => [
    scope.kind,
    scope.exists ? 'present' : 'absent',
    scope.writable ? 'writable' : 'read-only',
    scope.root,
  ])
  const lines = [
    style.bold('Scopes, highest precedence first:'),
    ...columns(rows).map((line) => '  ' + line),
    '',
    `New definitions are written to the ${style.bold(context.chain.defaultWriteScope)} scope.`,
  ]
  if (context.chain.gitRoot !== undefined) {
    lines.push(style.dim(`Nearest repository: ${context.chain.gitRoot}`))
  }
  return ok(lines, {
    scopes: context.chain.scopes,
    defaultWriteScope: context.chain.defaultWriteScope,
    gitRoot: context.chain.gitRoot,
  })
}

/** `factory init` — create a scope directory that is ready to use. */
export function init(
  context: CliContext,
  options: { scope?: ScopeKind },
  style: Style,
): CommandResult {
  const kind = options.scope ?? (context.chain.gitRoot === undefined ? 'user' : 'project')

  if (kind === 'builtin') {
    return failed(['The built-in scope ships inside the package and cannot be created.'])
  }

  const root =
    kind === 'project'
      ? join(context.chain.gitRoot ?? context.cwd, SCOPE_DIR)
      : (context.chain.scopes.find((scope) => scope.kind === 'user')?.root ?? '')

  if (existsSync(join(root, SCOPE_CONFIG_FILE))) {
    return ok([`Already initialised: ${root}`])
  }

  // From the kind list rather than a hand-written pair, so a scope created
  // today has a directory for every kind Factory knows about.
  for (const directory of DEFINITION_DIRECTORIES) {
    mkdirSync(join(root, directory), { recursive: true })
  }

  // What a run produces is not what a project committed. Written next to the
  // directory it is about, and only when it is not already there — the moment
  // it exists it is the user's file to edit.
  if (kind === 'project') {
    const ignore = join(root, '..', '.gitignore')
    if (!existsSync(ignore)) writeFileSync(ignore, `${IGNORED_BY_PRODUCT}\n`)
  }
  writeFileSync(
    join(root, SCOPE_CONFIG_FILE),
    kind === 'project'
      ? [
          '# Factory definitions for this project.',
          '#',
          '# Commit this directory. Anyone who clones the repository gets these',
          '# workflows, phases and plugins with no separate install step, and they',
          '# take precedence over anything in ~/.xaedalon/.factory.',
          '#',
          '# What runs produce lives beside it, under tasks/, and is ignored.',
          'kind: factory.scope/v1',
          'scope: project',
          '',
          '# plugins:',
          '#   - ./plugins/my-plugin.mjs',
          '',
        ].join('\n')
      : [
          '# Your personal Factory definitions.',
          '#',
          "# These apply everywhere you work, and any project's own",
          '# .xaedalon/.factory directory takes precedence over them.',
          'kind: factory.scope/v1',
          'scope: user',
          '',
        ].join('\n'),
  )

  return ok([
    `${style.green('Created')} ${kind} scope at ${root}`,
    '',
    'Next:',
    '  factory workflow list      what is available here',
    '  factory doctor             check the installation',
  ])
}
