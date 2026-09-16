import { EXECUTION_PROFILE_LABELS } from './profile.js'

/**
 * What a person is told before Factory runs an agent for them the first time.
 *
 * Factory coordinates other people's coding agents against real repositories.
 * Until now it did that with `--permission-mode bypassPermissions`, with no
 * boundary of its own, and said nothing about any of it — so the first time
 * anybody found out what a run could reach was by reading the source.
 *
 * One screen, once, and then never again. The onboarding the standard asks for
 * is "select repository, connect provider, start workflow", so this is the only
 * thing added to it — and it is added because "the user should be aware" cannot
 * be satisfied by a paragraph in a README nobody has to open.
 *
 * The text lives in core because three places show it: the browser's first-run
 * panel, `factory accept --show`, and the security docs. One wording, so the
 * thing a person agreed to is the thing that is true.
 */

/**
 * Which disclaimer has been accepted.
 *
 * A number, not a boolean, so that changing what Factory does materially can
 * ask again. Bump it only for a change in what an agent may reach — not for
 * rewording, which would nag people about a comma.
 */
export const DISCLAIMER_VERSION = 1

export const DISCLAIMER = {
  version: DISCLAIMER_VERSION,
  title: 'Before Factory runs an agent for you',
  /** The claim. Short enough to read, specific enough to mean something. */
  summary:
    'Factory agents can autonomously read, write and delete files, and run ' +
    "development commands, inside the workspace of the project you're working " +
    'on. Anything outside that workspace requires your permission.',
  /** What is actually true, per layer. No layer claims more than it delivers. */
  points: [
    'Each task runs in its own directory — a git worktree where the project ' +
      'uses them — and that directory is the boundary.',
    'Credentials that look like credentials are withheld from the agent: ' +
      'cloud keys, registry tokens, your SSH agent. The agent CLI keeps only ' +
      'the one it needs to authenticate itself.',
    'How much the agent CLI confines itself varies by provider, and Factory ' +
      'does not pretend otherwise — `factory doctor` says what each one adds.',
    'Factory can stop what it started: a run kills its whole process tree, ' +
      'and so does shutting the daemon down.',
    `The ${EXECUTION_PROFILE_LABELS['full-access']} profile removes these ` +
      'boundaries. It is never the default, has to be chosen per project, and ' +
      'is shown on screen the whole time it is on.',
  ],
  /** Said plainly, because the alternative is discovering it later. */
  caveat:
    'Factory is not a sandbox. It constrains what it launches and what that ' +
    'process can see, and a determined agent running arbitrary commands is ' +
    'not fully containable by either. Use it on work you can review and ' +
    'revert.',
} as const

/** Whether this installation has accepted the disclaimer as it currently stands. */
export function hasAccepted(acceptedVersion: number | undefined): boolean {
  return acceptedVersion !== undefined && acceptedVersion >= DISCLAIMER_VERSION
}

/**
 * The refusal, when a run is asked for and nothing has been accepted.
 *
 * A sentence a person can act on rather than a status code to look up, and the
 * same one whichever client asked — which is the whole reason the check is in
 * one function rather than in each route.
 */
export const NOT_ACCEPTED =
  'Factory has not been told that you understand what an agent run can reach. ' +
  'Accept it once — in the browser, or with `factory accept` — and this will ' +
  'not be asked again.'
