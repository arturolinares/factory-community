/**
 * The daemon's event stream, in the browser.
 *
 * `EventSource` rather than a websocket or a poll: the traffic is one-way, and
 * the browser reconnects on its own with no code of ours. The prototype polled
 * every two seconds, which was both slower to notice a change and busier when
 * nothing was happening.
 *
 * Subscribers get the event name; what they do about it is their business.
 * Most pages simply reload, which on a loopback socket costs nothing and cannot
 * drift from the daemon the way an incrementally patched client can.
 *
 * One socket for the whole page, however many subscribers. The board, the task
 * page and the project rail are all live at once, and three connections would
 * mean the same frame parsed three times and three reconnection backoffs
 * drifting apart after a daemon restart. `close()` therefore unsubscribes; the
 * socket itself goes when the last subscriber leaves.
 */
export interface LiveConnection {
  close(): void
}

/**
 * Named events carry their name in the SSE `event:` field, so each is listened for.
 *
 * A second, partial copy of `FactoryEvents` — every new event has to be added
 * here too, and forgetting is invisible: the board simply stops updating for
 * that one. `approval.granted` was missing for exactly that reason. Recorded in
 * improvements.md as something to derive rather than maintain; until then, this
 * comment is the warning.
 */
const EVENTS = [
  'task.created',
  'task.transitioned',
  'task.assigned',
  'task.deleted',
  'task.flags.changed',
  'run.started',
  'run.completed',
  'step.started',
  'step.completed',
  'step.failed',
  'approval.requested',
  'approval.granted',
  'permission.requested',
  'project.added',
  'project.changed',
  'project.removed',
] as const

const subscribers = new Set<(name: string) => void>()
let source: EventSource | undefined

function open(): void {
  source = new EventSource('/api/events')
  const forward = (event: MessageEvent): void => {
    try {
      const payload = JSON.parse(event.data as string) as { name?: string }
      if (typeof payload.name === 'string') {
        // Copied before iterating: a subscriber that unsubscribes in its own
        // handler would otherwise change the set underneath the loop.
        for (const subscriber of [...subscribers]) subscriber(payload.name)
      }
    } catch {
      // A malformed frame is not worth breaking the page over.
    }
  }
  source.addEventListener('message', forward)
  for (const name of EVENTS) source.addEventListener(name, forward as EventListener)
}

export function live(onEvent: (name: string) => void): LiveConnection {
  // Guarded because the same stores are exercised in environments without one
  // (jsdom, a server render); the page still works, it just does not update
  // until something asks it to.
  if (typeof EventSource === 'undefined') return { close: () => {} }

  subscribers.add(onEvent)
  if (source === undefined) open()

  let closed = false
  return {
    close: () => {
      if (closed) return
      closed = true
      subscribers.delete(onEvent)
      if (subscribers.size === 0) {
        source?.close()
        source = undefined
      }
    },
  }
}
