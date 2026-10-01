import { describe, it, expect } from 'vitest'
import { closedView, errorText } from '../src/room/roomErrors'

describe('closedView', () => {
  it('offers "Use here" when another tab took over (4001)', () => {
    expect(closedView(4001, null)).toEqual({ kind: 'replaced', text: 'Opened in another tab' })
  })

  it('asks for the password when the join was refused with bad_password', () => {
    expect(closedView(4006, 'bad_password')).toEqual({ kind: 'password' })
  })

  it('sends the user back to the join page when the identity is no longer accepted (4002)', () => {
    expect(closedView(4002, 'unauthorized')).toEqual({ kind: 'rejoin' })
    expect(closedView(4002, null)).toEqual({ kind: 'rejoin' })
  })

  it('gives distinct messages for each join refusal', () => {
    const text = (code: Parameters<typeof closedView>[1]) => {
      const v = closedView(4006, code)
      return v.kind === 'message' ? v.text : v.kind
    }
    const seen = new Set([text('room_full'), text('forbidden'), text('not_found'), text('rate_limited'), text(null)])
    expect(seen.size).toBe(5)
    expect(text('room_full')).toMatch(/full/)
    expect(text('forbidden')).toMatch(/signed-in/)
    expect(text('not_found')).toMatch(/does not exist|closed/)
    expect(closedView(4006, 'forbidden')).toMatchObject({ signIn: true })
  })

  it('keeps the existing texts for kick, ban, room closed and rate limit', () => {
    expect(closedView(4003, null)).toEqual({ kind: 'message', text: 'You were removed from this room.' })
    expect(closedView(4004, 'banned')).toEqual({ kind: 'message', text: 'You are banned from this room.' })
    expect(closedView(4005, null)).toEqual({ kind: 'message', text: 'This room was closed.' })
    expect(closedView(4008, 'rate_limited')).toMatchObject({ kind: 'message', text: expect.stringMatching(/too many messages/) })
    expect(closedView(1234, null)).toEqual({ kind: 'message', text: 'The connection was closed.' })
  })
})

describe('errorText', () => {
  it('does not show a permission toast when forbidden answers a control message', () => {
    expect(errorText('forbidden', 'control')).toBeNull()
  })
  it('explains a refused chat message without talking about permissions', () => {
    expect(errorText('forbidden', 'chat')).toBe("You can't chat right now.")
  })
  it('keeps the permission text for other refusals', () => {
    expect(errorText('forbidden', 'mod')).toBe('You do not have permission to do that.')
    expect(errorText('forbidden', null)).toBe('You do not have permission to do that.')
  })
  it('stays silent for stale and join-time errors', () => {
    expect(errorText('stale', 'control')).toBeNull()
    expect(errorText('bad_password', null)).toBeNull()
    expect(errorText('rate_limited', 'chat')).toBe('Slow down a little.')
  })
})
