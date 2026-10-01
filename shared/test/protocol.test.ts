import { describe, it, expect } from 'vitest'
import { clientMessageSchema } from '../src'

const parse = (m: unknown) => clientMessageSchema.safeParse(m)

describe('clientMessageSchema', () => {
  it('accepts a valid control message', () => {
    expect(parse({ type: 'control', version: 3, action: 'seek', position: 12.5 }).success).toBe(true)
  })
  it('accepts hello, ping, chat, buffering, mod, settings', () => {
    expect(parse({ type: 'hello', token: 't' }).success).toBe(true)
    expect(parse({ type: 'ping', t0: 1 }).success).toBe(true)
    expect(parse({ type: 'chat', text: 'hi' }).success).toBe(true)
    expect(parse({ type: 'buffering', value: true }).success).toBe(true)
    expect(parse({ type: 'mod', op: 'kick', target: 'u1' }).success).toBe(true)
    expect(parse({ type: 'settings', patch: { maxViewers: 20 } }).success).toBe(true)
  })
  it('rejects unknown message types', () => {
    expect(parse({ type: 'eval', code: 'x' }).success).toBe(false)
  })
  it('rejects negative and non-finite positions', () => {
    expect(parse({ type: 'control', version: 0, action: 'seek', position: -1 }).success).toBe(false)
    expect(parse({ type: 'control', version: 0, action: 'seek', position: Infinity }).success).toBe(false)
  })
  it('rejects a settings patch that tries to change the password or unknown keys', () => {
    expect(parse({ type: 'settings', patch: { password: 'x' } }).success).toBe(false)
  })
  it('rejects maxViewers above the hard cap of 30', () => {
    expect(parse({ type: 'settings', patch: { maxViewers: 31 } }).success).toBe(false)
  })
  it('rejects an oversized token', () => {
    expect(parse({ type: 'hello', token: 'x'.repeat(5000) }).success).toBe(false)
  })
})
