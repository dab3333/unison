import { describe, it, expect } from 'vitest'
import { prefersReducedMotion } from '../src/lib/motion'

const win = (matches: boolean) => ({ matchMedia: (q: string) => ({ matches: q.includes('prefers-reduced-motion') && matches }) })

describe('prefersReducedMotion', () => {
  it('is true when the user asked for reduced motion', () => {
    expect(prefersReducedMotion(win(true))).toBe(true)
  })
  it('is false when they did not', () => {
    expect(prefersReducedMotion(win(false))).toBe(false)
  })
  it('is false when there is no window or no matchMedia (server, old browsers)', () => {
    expect(prefersReducedMotion(undefined)).toBe(false)
    expect(prefersReducedMotion({})).toBe(false)
  })
  it('is false rather than throwing if matchMedia fails', () => {
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error('nope') } })).toBe(false)
  })
})
