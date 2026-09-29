import { describe, it, expect } from 'vitest'
import { availableOps, canModerateChat } from '../src/room/permissions'

describe('availableOps', () => {
  it('lets the host mute, kick and ban guests but not promote them', () => {
    expect(availableOps('host', { role: 'guest', muted: false })).toEqual(['mute', 'kick', 'ban'])
  })
  it('lets the host promote members and demote moderators', () => {
    expect(availableOps('host', { role: 'member', muted: false })).toEqual(['mute', 'kick', 'ban', 'promote'])
    expect(availableOps('host', { role: 'moderator', muted: false })).toEqual(['mute', 'kick', 'ban', 'demote'])
  })
  it('offers unmute for muted people', () => {
    expect(availableOps('host', { role: 'guest', muted: true })).toEqual(['unmute', 'kick', 'ban'])
  })
  it('lets moderators mute and kick lower roles only', () => {
    expect(availableOps('moderator', { role: 'guest', muted: false })).toEqual(['mute', 'kick'])
    expect(availableOps('moderator', { role: 'member', muted: false })).toEqual(['mute', 'kick'])
    expect(availableOps('moderator', { role: 'moderator', muted: false })).toEqual([])
    expect(availableOps('moderator', { role: 'host', muted: false })).toEqual([])
  })
  it('gives members and guests nothing', () => {
    expect(availableOps('member', { role: 'guest', muted: false })).toEqual([])
    expect(availableOps('guest', { role: 'guest', muted: false })).toEqual([])
  })
})

describe('canModerateChat', () => {
  it('is true for host and moderator only', () => {
    expect(canModerateChat('host')).toBe(true)
    expect(canModerateChat('moderator')).toBe(true)
    expect(canModerateChat('member')).toBe(false)
    expect(canModerateChat(undefined)).toBe(false)
  })
})
