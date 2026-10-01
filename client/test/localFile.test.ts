import { describe, it, expect } from 'vitest'
import type { Source } from '@unison/shared'
import { validateSource } from '@unison/shared'
import { fileForSource, pickedFor } from '../src/room/localFile'

const file = { name: 'a.mp4' } as File
const S: Source = { type: 'file', name: 'a.mp4', size: 10, duration: 60 }
const S2: Source = { type: 'file', name: 'b.mp4', size: 20, duration: 90 }

describe('fileForSource', () => {
  it('returns the file for the source it was picked for', () => {
    expect(fileForSource(pickedFor(file, S), S)).toBe(file)
  })
  it('matches an equal source with a different key order', () => {
    const reordered = { duration: 60, size: 10, name: 'a.mp4', type: 'file' } as Source
    expect(fileForSource(pickedFor(file, S), reordered)).toBe(file)
  })
  it('returns null for a different source', () => {
    expect(fileForSource(pickedFor(file, S), S2)).toBeNull()
  })
  it('returns null when the source is null', () => {
    expect(fileForSource(pickedFor(file, S), null)).toBeNull()
  })
  it('returns null when nothing was picked', () => {
    expect(fileForSource(null, S)).toBeNull()
  })
  it('returns null for a URL source after picking for a file source', () => {
    expect(fileForSource(pickedFor(file, S), { type: 'url', url: 'https://x.test/a.mp4' } as Source)).toBeNull()
  })
})

describe('fileForSource with server-normalized sources', () => {
  const odd: Record<string, string> = {
    control: 'a\u0007b.mp4',
    zeroWidth: 'a​b‮c.mp4',
    doubleSpace: 'my  movie.mp4',
    padded: '  movie.mp4  ',
    long: '  ' + 'x'.repeat(190) + '  y.mp4',   // 200 chars, the schema maximum; longer is rejected by the server outright
  }
  for (const [label, name] of Object.entries(odd)) {
    it(`matches the echoed source for a ${label} name`, () => {
      const raw: Source = { type: 'file', name, size: 10, duration: 60 }
      const echoed = validateSource(raw)!
      expect(echoed).not.toBeNull()
      expect(fileForSource(pickedFor(file, raw), echoed)).toBe(file)
    })
  }
  it('ignores extra fields', () => {
    const raw = { type: 'file', name: 'a.mp4', size: 10, duration: 60, extra: 1 } as unknown as Source
    expect(fileForSource(pickedFor(file, raw), S)).toBe(file)
  })
  it('still rejects a different size or normalized name', () => {
    const raw: Source = { type: 'file', name: 'my  movie.mp4', size: 10, duration: 60 }
    expect(fileForSource(pickedFor(file, raw), validateSource({ ...raw, size: 11 })!)).toBeNull()
    expect(fileForSource(pickedFor(file, raw), validateSource({ ...raw, name: 'my other.mp4' })!)).toBeNull()
  })
})
