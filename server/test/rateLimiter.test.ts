import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../src/rateLimiter'

describe('RateLimiter', () => {
  it('allows up to the limit inside the window, then blocks', () => {
    let t = 0
    const rl = new RateLimiter(3, 10_000, () => t)
    expect([rl.allow('a'), rl.allow('a'), rl.allow('a'), rl.allow('a')]).toEqual([true, true, true, false])
  })
  it('allows again after the window slides', () => {
    let t = 0
    const rl = new RateLimiter(2, 10_000, () => t)
    rl.allow('a'); rl.allow('a')
    expect(rl.allow('a')).toBe(false)
    t = 10_001
    expect(rl.allow('a')).toBe(true)
  })
  it('tracks keys independently and supports reset', () => {
    const rl = new RateLimiter(1, 10_000, () => 0)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('b')).toBe(true)
    expect(rl.allow('a')).toBe(false)
    rl.reset('a')
    expect(rl.allow('a')).toBe(true)
  })
})
