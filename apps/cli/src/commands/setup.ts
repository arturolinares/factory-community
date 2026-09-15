import { runSetup, type SetupItem } from '@factory/core'
import { daemonUrl, type DaemonClient } from '../daemon.js'
import type { Style } from '../render.js'
import { ok, type CliContext, type CommandResult } from '../context.js'

/**
 * `factory setup` — what is still missing.
 *
 * Asks the daemon when one is running, because half the checklist lives in the
 * database it owns: whether a repository has been added is not a question a
 * file can answer. Falls back to the local view when nothing is listening, so
 * the command works before anything has been started — which is precisely when
 * somebody runs it.
 */
export async function setup(
  client: DaemonClient,
  context: CliContext,
  style: Style,
): Promise<CommandResult> {
  const report = await fromDaemon(client).catch(() => undefined)
  const local = report ?? (await runSetup({ host: context.host, env: context.env }))

  const lines: string[] = []
  for (const item of local.items) {
    lines.push(`${item.done ? style.green('✓') : style.yellow('•')} ${style.bold(item.title)}`)
    if (item.detail !== undefined) lines.push(style.dim(`    ${item.detail}`))

    for (const action of item.actions ?? []) {
      lines.push(`    ${action.label}`)
      if (action.command !== undefined) lines.push(style.dim(`      ${action.command}`))
      if (action.config !== undefined) {
        for (const line of action.config.split('\n')) lines.push(style.dim(`      ${line}`))
      }
      if (action.url !== undefined) lines.push(style.dim(`      ${absolute(action.url, client)}`))
    }
    lines.push('')
  }

  lines.push(
    local.remaining === 0
      ? style.green('Everything is set up.')
      : local.ready
        ? `${local.remaining} thing${local.remaining === 1 ? '' : 's'} left, none of them blocking.`
        : style.yellow(`${local.remaining} left, and Factory cannot run work until the essential ones are done.`),
  )
  if (report === undefined) {
    lines.push(
      style.dim('The daemon is not running, so this is only what the files can tell you.'),
    )
  }
  return ok(lines, local)
}

/** A page is only reachable if something is serving it. */
const absolute = (url: string, client: DaemonClient): string =>
  url.startsWith('/') ? `${client.url}${url}` : url

async function fromDaemon(client: DaemonClient) {
  return client.request<Awaited<ReturnType<typeof runSetup>>>('/api/setup')
}

/** Exported for the command table's help text. */
export const setupUrl = daemonUrl

export type { SetupItem }
