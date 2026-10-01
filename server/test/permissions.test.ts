import { describe, it, expect } from 'vitest'
import { can, canTarget } from '../src/permissions'

const host = { controlMode: 'host' as const }
const everyone = { controlMode: 'everyone' as const }

describe('can', () => {
  it('lets only the host control playback in host mode', () => {
    expect(can('host', 'control', host)).toBe(true)
    expect(can('moderator', 'control', host)).toBe(false)
    expect(can('member', 'control', host)).toBe(false)
    expect(can('guest', 'control', host)).toBe(false)
  })
  it('lets everyone control in everyone mode', () => {
    for (const r of ['host', 'moderator', 'member', 'guest'] as const) expect(can(r, 'control', everyone)).toBe(true)
  })
  it('lets moderators kick, mute and delete messages but not ban, promote or change settings', () => {
    for (const a of ['kick', 'mute', 'deleteMessage'] as const) expect(can('moderator', a, host)).toBe(true)
    for (const a of ['ban', 'promote', 'settings'] as const) expect(can('moderator', a, host)).toBe(false)
  })
  it('denies members and guests every moderation action', () => {
    for (const a of ['kick', 'mute', 'ban', 'promote', 'settings', 'deleteMessage'] as const) {
      expect(can('member', a, host)).toBe(false)
      expect(can('guest', a, host)).toBe(false)
    }
  })
  it('lets everyone chat', () => {
    for (const r of ['host', 'moderator', 'member', 'guest'] as const) expect(can(r, 'chat', host)).toBe(true)
  })
})

describe('canTarget', () => {
  it('only allows acting on strictly lower roles', () => {
    expect(canTarget('host', 'moderator')).toBe(true)
    expect(canTarget('moderator', 'guest')).toBe(true)
    expect(canTarget('moderator', 'moderator')).toBe(false)
    expect(canTarget('moderator', 'host')).toBe(false)
    expect(canTarget('host', 'host')).toBe(false)
  })
})
