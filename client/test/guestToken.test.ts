import { describe, it, expect } from 'vitest'
import { reusableGuestToken, tokenExpired } from '../src/lib/guestToken'

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const jwt = (payload: object) => `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`
const NOW = 1_800_000_000_000

describe('tokenExpired', () => {
  it('reads exp (seconds) from the payload without verifying', () => {
    expect(tokenExpired(jwt({ exp: NOW / 1000 + 3600 }), NOW)).toBe(false)
    expect(tokenExpired(jwt({ exp: NOW / 1000 - 1 }), NOW)).toBe(true)
  })
  it('treats a token about to expire as expired', () => {
    expect(tokenExpired(jwt({ exp: NOW / 1000 + 10 }), NOW)).toBe(true)
  })
  it('treats a malformed token as expired and one without exp as live', () => {
    expect(tokenExpired('not-a-jwt', NOW)).toBe(true)
    expect(tokenExpired('a.%%%.c', NOW)).toBe(true)
    expect(tokenExpired(jwt({ sub: 'x' }), NOW)).toBe(false)
  })
})

describe('reusableGuestToken', () => {
  const live = jwt({ exp: NOW / 1000 + 3600 })
  const dead = jwt({ exp: NOW / 1000 - 3600 })
  it('reuses a live stored token for the same nickname', () => {
    expect(reusableGuestToken({ token: live, nickname: 'Pat' }, 'Pat', NOW)).toBe(live)
  })
  it('does not reuse an expired token, a different nickname, or nothing', () => {
    expect(reusableGuestToken({ token: dead, nickname: 'Pat' }, 'Pat', NOW)).toBeNull()
    expect(reusableGuestToken({ token: live, nickname: 'Pat' }, 'Sam', NOW)).toBeNull()
    expect(reusableGuestToken(null, 'Pat', NOW)).toBeNull()
  })
})
