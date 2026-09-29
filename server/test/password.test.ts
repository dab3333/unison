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
})
