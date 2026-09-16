import {
  DISCLAIMER,
  DISCLAIMER_VERSION,
  EXECUTION_PROFILES,
  EXECUTION_PROFILE_LABELS,
  hasAccepted,
  isExecutionProfile,
  type ExecutionProfile,
} from '@factory/core'
import { renderProblem, type Style } from '../render.js'
import { failed, ok, type CliContext, type CommandResult } from '../context.js'
import { asFailure, type DaemonClient } from '../daemon.js'

/**
 * `factory accept` and `factory profile` — the terminal half of the disclaimer.
 *
 * The daemon refuses to queue a run until somebody has been told what a run can
 * reach, and it refuses that for *every* client. So the terminal needs a way to
 * say yes, or the gate would be a browser feature with a command-line hole in
 * it — and anybody automating Factory would be told to go and click something.
 */

/** Wrapped by hand: this is prose, and prose at terminal width reads better. */
function wrap(text: string, width = 76): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line === '') line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

/** The disclaimer, as a person reads it in a terminal. */
export function showDisclaimer(style: Style): string[] {
  return [
    style.bold(DISCLAIMER.title),
    '',
    ...wrap(DISCLAIMER.summary),
    '',
    ...DISCLAIMER.points.flatMap((point) => {
      const [first, ...more] = wrap(point, 72)
      return [`  · ${first ?? ''}`, ...more.map((line) => `    ${line}`)]
    }),
    '',
    ...wrap(DISCLAIMER.caveat),
  ]
}

/**
 * `factory accept [--show]`
 *
 * `--show` prints it and records nothing, so reading it is not agreeing to it.
 */
export function accept(
  context: CliContext,
  flags: { show?: boolean },
  style: Style,
): CommandResult {
  const already = hasAccepted(context.settings.current().security.acceptedVersion)

  if (flags.show === true) {
    return ok([
      ...showDisclaimer(style),
      '',
      already
        ? style.dim(`Accepted (version ${DISCLAIMER_VERSION}).`)
        : style.dim('Not accepted. Run "factory accept" to accept it.'),
    ])
  }

  if (already) {
    return ok([style.dim(`Already accepted (version ${DISCLAIMER_VERSION}).`)])
  }

  const saved = context.settings.update({ security: { acceptedVersion: DISCLAIMER_VERSION } })
  if (saved.problems.length > 0) {
    return failed(saved.problems.map((problem) => renderProblem(problem, style)))
  }
  return ok([
    ...showDisclaimer(style),
    '',
    style.green('Accepted. Factory will not ask again.'),
    style.dim(`Recorded in ${context.settings.file ?? 'the user scope'}.`),
  ])
}

/**
 * `factory profile [<profile>]` — the installation's default, read or written.
 *
 * Per-project profiles are not settable here on purpose: a project lives in the
 * database the daemon owns, and a CLI that wrote to it directly would be a
 * second writer. The daemon's route is the one door.
 */
export function profile(
  context: CliContext,
  wanted: string | undefined,
  style: Style,
): CommandResult {
  const settings = context.settings.current()

  if (wanted === undefined) {
    return ok([
      `${style.bold('Installation profile')}  ${
        EXECUTION_PROFILE_LABELS[settings.security.profile]
      }`,
      style.dim('What a project gets when it has not chosen for itself.'),
    ])
  }

  if (!isExecutionProfile(wanted)) {
    return failed([
      `"${wanted}" is not a profile. Try ${EXECUTION_PROFILES.join(' or ')}.`,
    ])
  }

  const saved = context.settings.update({ security: { profile: wanted as ExecutionProfile } })
  if (saved.problems.length > 0) {
    return failed(saved.problems.map((problem) => renderProblem(problem, style)))
  }
  return ok([
    `${style.bold('Installation profile')}  ${EXECUTION_PROFILE_LABELS[wanted]}`,
    ...(wanted === 'full-access'
      ? [
          style.yellow(
            'Full Access removes the workspace boundary and passes every credential ' +
              'through. Use it where you can restore the machine.',
          ),
        ]
      : []),
  ])
}

/**
 * `factory stop [--all]` — the kill switch, from a terminal.
 *
 * Deliberately requires `--all` rather than defaulting to it: "stop" with no
 * argument reads like it might mean one thing, and the one thing it does mean
 * is everything.
 *
 * Goes through the daemon, because the daemon is what holds the processes. A
 * CLI that tried to find and signal them itself would be a second
 * implementation of the one thing that must not be wrong twice.
 */
export async function stop(
  client: DaemonClient,
  style: Style,
): Promise<CommandResult> {
  try {
    const report = await client.request<{
      stopped: string[]
      signalled: number
      killed: number
    }>('/api/runs/stop', { method: 'POST' })

    if (report.signalled === 0) {
      return ok([style.dim('Nothing was running.')])
    }
    return ok([
      style.green(
        `Stopped ${report.signalled} process group${report.signalled === 1 ? '' : 's'}` +
          `${report.killed > 0 ? `, ${report.killed} of which had to be killed` : ''}.`,
      ),
      ...(report.stopped.length === 0
        ? []
        : [style.dim(`Tasks cancelled: ${report.stopped.join(', ')}`)]),
    ])
  } catch (error) {
    return asFailure(error)
  }
}
