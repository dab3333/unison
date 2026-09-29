import { describe, it, expect } from 'vitest'
import { derivePosition, decideDrift, pickClockOffset } from '../src'

describe('derivePosition', () => {
  it('returns the stored position when paused', () => {
    expect(derivePosition({ isPlaying: false, position: 10, updatedAt: 1000 }, 9000)).toBe(10)
  })
  it('advances with server time when playing', () => {
    expect(derivePosition({ isPlaying: true, position: 10, updatedAt: 1000 }, 3500)).toBeCloseTo(12.5)
  })
  it('never goes backwards if serverNow is before updatedAt', () => {
    expect(derivePosition({ isPlaying: true, position: 10, updatedAt: 5000 }, 4000)).toBe(10)
  })
})

describe('decideDrift', () => {
  it('does nothing under 0.3s', () => {
    expect(decideDrift(10.2, 10)).toEqual({ kind: 'none' })
    expect(decideDrift(9.8, 10)).toEqual({ kind: 'none' })
  })
  it('slows down when ahead by 0.3 to 2s', () => {
    expect(decideDrift(10.5, 10)).toEqual({ kind: 'rate', rate: 0.95 })
    expect(decideDrift(12, 10)).toEqual({ kind: 'rate', rate: 0.95 })
  })
  it('speeds up when behind by 0.3 to 2s', () => {
    expect(decideDrift(9.5, 10)).toEqual({ kind: 'rate', rate: 1.05 })
  })
  it('hard seeks over 2s', () => {
    expect(decideDrift(13, 10)).toEqual({ kind: 'seek', to: 10 })
    expect(decideDrift(5, 10)).toEqual({ kind: 'seek', to: 10 })
  })
})

describe('pickClockOffset', () => {
  it('uses the lowest round-trip sample', () => {
    const offset = pickClockOffset([
      { t0: 1000, t1: 1200, serverTime: 5100 },
      { t0: 2000, t1: 2040, serverTime: 6120 },
    ])
    expect(offset).toBe(4100) // 6120 - (2000 + 20)
  })
  it('returns 0 with no samples', () => {
    expect(pickClockOffset([])).toBe(0)
  })
})
