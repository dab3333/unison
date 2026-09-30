import { describe, it, expect } from 'vitest'
import { hashPassword, checkPassword } from '../src/password'

describe('password', () => {
  it('verifies the right password and rejects the wrong one', () => {
    const h = hashPassword('hunter2')
    expect(h).not.toContain('hunter2')
    expect(checkPassword('hunter2', h)).toBe(true)
    expect(checkPassword('nope', h)).toBe(false)
    expect(checkPassword(undefined, h)).toBe(false)
  })
  it('uses a fresh salt each time', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'))
  })
  it('accepts anything when no password is set', () => {
    expect(checkPassword(undefined, null)).toBe(true)
    expect(checkPassword('whatever', null)).toBe(true)
  })
  it('rejects a corrupt stored value', () => {
    expect(checkPassword('x', 'garbage')).toBe(false)
  })
  it('rejects stored hashes that are not a 32-byte hex hash with a hex salt (M2)', () => {
    const good = hashPassword('x')
    const [salt, hash] = good.split(':') as [string, string]
    expect(checkPassword('x', 'zz:zz')).toBe(false) // non-hex decodes to an empty buffer
    expect(checkPassword('x', `${salt}:`)).toBe(false)
    expect(checkPassword('x', `${salt}:${hash.slice(0, 32)}`)).toBe(false) // 16 bytes, not 32
    expect(checkPassword('x', `${salt}:${'g'.repeat(64)}`)).toBe(false)
    expect(checkPassword('x', `zz:${hash}`)).toBe(false)
    expect(checkPassword('x', good)).toBe(true)
  })
})
