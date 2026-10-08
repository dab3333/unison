import { describe, it, expect } from 'vitest'
import { userInitial } from '../src/lib/userInitial'

describe('userInitial', () => {
  it('uses the first letter, uppercased', () => {
    expect(userInitial('maya')).toBe('M')
    expect(userInitial('Dev Host')).toBe('D')
  })
  it('skips leading whitespace', () => {
    expect(userInitial('  leo')).toBe('L')
  })
  it('keeps a whole emoji or other astral character instead of half a surrogate pair', () => {
    expect(userInitial('😀 party')).toBe('😀')
  })
  it('falls back to a question mark for empty or missing names', () => {
    expect(userInitial('')).toBe('?')
    expect(userInitial('   ')).toBe('?')
    expect(userInitial(undefined)).toBe('?')
  })
})
