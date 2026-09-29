import { describe, it, expect } from 'vitest'
import { hashIp } from '../src/privacy'

const DAY = 86_400_000
describe('hashIp', () => {
  it('is stable within a day and never contains the raw IP', () => {
    const a = hashIp('203.0.113.9', 'salt', 5 * DAY + 1000)
    expect(hashIp('203.0.113.9', 'salt', 5 * DAY + 90_000)).toBe(a)
    expect(a).not.toContain('203')
    expect(a).toHaveLength(32)
  })
  it('rotates each day and differs by IP and secret', () => {
    const a = hashIp('203.0.113.9', 'salt', 5 * DAY)
    expect(hashIp('203.0.113.9', 'salt', 6 * DAY)).not.toBe(a)
    expect(hashIp('203.0.113.10', 'salt', 5 * DAY)).not.toBe(a)
    expect(hashIp('203.0.113.9', 'other', 5 * DAY)).not.toBe(a)
  })
})
