import type { ErrorCode } from '@unison/shared'

/** The kind of the last request we sent that the server may refuse (pings and buffering reports are never refused). */
export type SentKind = 'control' | 'chat' | 'mod' | 'settings' | null

export function errorText(code: ErrorCode, lastSent: SentKind): string | null {
  switch (code) {
    case 'forbidden':
      if (lastSent === 'control') return null // the SyncClient snaps back; a viewer never meant to control
      if (lastSent === 'chat') return "You can't chat right now."
      return 'You do not have permission to do that.'
    case 'rate_limited': return 'Slow down a little.'
    case 'bad_request': return 'That did not work.'
    case 'stale': return null // the SyncClient silently snaps back
    default: return null // join refusals are shown on the closed screen instead
  }
}

export const CLOSED_TEXT: Record<number, string> = {
  4001: 'Opened in another tab',
  4003: 'You were removed from this room.',
  4004: 'You are banned from this room.',
  4005: 'This room was closed.',
  4006: 'Could not join this room.',
  4008: 'You were disconnected for sending too many messages.',
}

const REFUSED: Partial<Record<ErrorCode, string>> = {
  room_full: 'This room is full. Try again in a little while.',
  forbidden: 'This room is for signed-in members only.',
  not_found: 'This room does not exist or was closed by its host.',
  rate_limited: 'Too many wrong passwords. Wait a minute and try again.',
}

export type ClosedView =
  | { kind: 'replaced'; text: string } // offer "Use here"
  | { kind: 'password' } // ask for the room password, then reconnect
  | { kind: 'rejoin' } // identity expired or rejected: back to the join page
  | { kind: 'message'; text: string; signIn?: boolean }

/** What the room screen shows after a terminal close, given the last server error code before it. */
export function closedView(code: number, lastError: ErrorCode | null): ClosedView {
  if (code === 4001) return { kind: 'replaced', text: CLOSED_TEXT[4001]! }
  if (code === 4002) return { kind: 'rejoin' }
  if (code === 4006) {
    if (lastError === 'bad_password') return { kind: 'password' }
    const text = (lastError && REFUSED[lastError]) ?? CLOSED_TEXT[4006]!
    return lastError === 'forbidden' ? { kind: 'message', text, signIn: true } : { kind: 'message', text }
  }
  return { kind: 'message', text: CLOSED_TEXT[code] ?? 'The connection was closed.' }
}
