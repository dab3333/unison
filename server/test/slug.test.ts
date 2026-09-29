import { describe, it, expect } from 'vitest'
import { newSlug } from '../src/slug'

describe('newSlug', () => {
  it('is two words plus an unguessable lowercase suffix of unambiguous characters', () => {
    for (let i = 0; i < 50; i++) expect(newSlug()).toMatch(/^[a-z]+-[a-z]+-[0-9abcdefghjkmnpqrstvwxyz]{6}$/)
  })
  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newSlug()))
    expect(seen.size).toBe(2000)
  })
})
