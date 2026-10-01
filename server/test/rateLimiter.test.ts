import { describe, it, expect } from 'vitest'
import { RateLimiter, TokenBucket } from '../src/rateLimiter'

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
  it('prune() drops keys whose hits have all expired and keeps live ones', () => {
    let t = 0
    const rl = new RateLimiter(1, 10_000, () => t)
    rl.allow('old')
    t = 5_000
    rl.allow('live')
    t = 10_000
    rl.prune()
    expect(rl.size).toBe(1)
    expect(rl.allow('live')).toBe(false) // still limited: its hit was kept
    expect(rl.allow('old')).toBe(true)
  })
  it('wouldAllow() checks without recording a hit', () => {
    const rl = new RateLimiter(1, 10_000, () => 0)
    expect(rl.wouldAllow('a')).toBe(true)
    expect(rl.wouldAllow('a')).toBe(true)
    rl.allow('a')
    expect(rl.wouldAllow('a')).toBe(false)
  })
})

describe('TokenBucket', () => {
  it('allows a burst, then refills at the sustained rate', () => {
    let t = 0
    const b = new TokenBucket(20, 5, () => t) // 20/s sustained, burst of 5
    expect(Array.from({ length: 6 }, () => b.take())).toEqual([true, true, true, true, true, false])
    t = 50 // 1 token back after 50ms at 20/s
    expect(b.take()).toBe(true)
    expect(b.take()).toBe(false)
    t = 10_000 // never more than the burst
    expect(Array.from({ length: 6 }, () => b.take()).filter(Boolean)).toHaveLength(5)
  })
})
