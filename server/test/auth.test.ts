import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { createAuth } from '../src/auth'

const enc = (s: string) => new TextEncoder().encode(s)
const auth = createAuth({ guestSecret: 'guest-secret-1234567890', supabaseJwtSecret: 'sb-secret-1234567890' })

async function supabaseToken(claims: Record<string, unknown>, opts: { exp?: string | number; secret?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setAudience('authenticated')
    .setExpirationTime(opts.exp ?? '1h')
    .sign(enc(opts.secret ?? 'sb-secret-1234567890'))
}

describe('guest tokens', () => {
  it('round-trips a guest identity', async () => {
    const token = await auth.issueGuest('PopcornPat', 'guest-1')
    expect(await auth.verify(token)).toEqual({ id: 'guest-1', nickname: 'PopcornPat', isGuest: true })
  })
  it('rejects a tampered token', async () => {
    const token = await auth.issueGuest('Pat', 'guest-1')
    expect(await auth.verify(token.slice(0, -3) + 'abc')).toBeNull()
  })
  it('rejects garbage', async () => {
    expect(await auth.verify('not-a-jwt')).toBeNull()
  })
})

describe('supabase tokens', () => {
  it('maps user_metadata name to a non-guest identity', async () => {
    const t = await supabaseToken({ user_metadata: { full_name: 'Maya Q' }, email: 'maya@x.com' })
    expect(await auth.verify(t)).toEqual({ id: 'user-1', nickname: 'Maya Q', isGuest: false })
  })
  it('falls back to the email prefix', async () => {
    const t = await supabaseToken({ email: 'leo@x.com' })
    expect((await auth.verify(t))?.nickname).toBe('leo')
  })
  it('rejects expired tokens, wrong secrets and wrong audience', async () => {
    expect(await auth.verify(await supabaseToken({}, { exp: Math.floor(Date.now() / 1000) - 10 }))).toBeNull()
    expect(await auth.verify(await supabaseToken({}, { secret: 'other-secret-1234567890' }))).toBeNull()
    const wrongAud = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setAudience('anon')
      .setExpirationTime('1h').sign(enc('sb-secret-1234567890'))
    expect(await auth.verify(wrongAud)).toBeNull()
  })
  it('does not accept a guest token as a Supabase token or the reverse', async () => {
    const onlySb = createAuth({ guestSecret: 'another-guest-secret-123', supabaseJwtSecret: 'sb-secret-1234567890' })
    const guestToken = await auth.issueGuest('Pat', 'g1')
    expect(await onlySb.verify(guestToken)).toBeNull()
  })
})
