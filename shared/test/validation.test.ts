import { describe, it, expect } from 'vitest'
import { sanitizeText, sanitizeNickname, validateSourceUrl, validateSource } from '../src'

describe('sanitizeText', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeText('  hi\u0000 there\n\nfriend\t ', 100)).toBe('hi there friend')
  })
  it('strips bidi override characters', () => {
    expect(sanitizeText('abc‮def', 100)).toBe('abc def')
  })
  it('truncates by code points, not UTF-16 units', () => {
    expect(sanitizeText('a😀b😀c', 3)).toBe('a😀b')
  })
  it('returns empty for non-strings', () => {
    expect(sanitizeText(42, 10)).toBe('')
    expect(sanitizeText(undefined, 10)).toBe('')
  })
})

describe('sanitizeNickname', () => {
  it('rejects whitespace-only and control-only names', () => {
    expect(sanitizeNickname('   ')).toBeNull()
    expect(sanitizeNickname('\u0000\u0007')).toBeNull()
  })
  it('caps at 24 characters', () => {
    expect(sanitizeNickname('x'.repeat(40))).toBe('x'.repeat(24))
  })
  it('keeps normal names', () => {
    expect(sanitizeNickname(' PopcornPat ')).toBe('PopcornPat')
  })
})

describe('validateSourceUrl', () => {
  const bad = [
    'http://example.com/a.mp4',
    'https://localhost/a.mp4',
    'https://foo.localhost/a.mp4',
    'https://127.0.0.1/a.mp4',
    'https://2130706433/a.mp4',
    'https://10.0.0.5/a.mp4',
    'https://172.16.0.1/a.mp4',
    'https://172.31.255.1/a.mp4',
    'https://192.168.1.1/a.mp4',
    'https://169.254.169.254/latest',
    'https://100.64.0.1/a.mp4',
    'https://0.0.0.0/a.mp4',
    'https://[::1]/a.mp4',
    'https://[fd00::1]/a.mp4',
    'https://[fe80::1]/a.mp4',
    'https://[::ffff:127.0.0.1]/a.mp4',
    'https://user:pass@example.com/a.mp4',
    'https://intranet/a.mp4',
    'https://printer.local/a.mp4',
    'https://db.internal/a.mp4',
    'https://localhost./a.mp4',
    'https://foo.local./a.mp4',
    'https://db.internal./a.mp4',
    'https://intranet./a.mp4',
    'https://127.0.0.1./a.mp4',
    'javascript:alert(1)',
    'not a url',
  ]
  for (const url of bad) {
    it(`rejects ${url}`, () => expect(validateSourceUrl(url).ok).toBe(false))
  }
  it('accepts a public https URL', () => {
    expect(validateSourceUrl('https://cdn.example.com/movie.mp4?x=1')).toEqual({
      ok: true,
      url: 'https://cdn.example.com/movie.mp4?x=1',
    })
  })
  it('accepts a public host with a trailing dot', () => {
    expect(validateSourceUrl('https://cdn.example.com./a.mp4').ok).toBe(true)
  })
  it('accepts 172.32.x (outside the private /12)', () => {
    expect(validateSourceUrl('https://172.32.0.1/a.mp4').ok).toBe(true)
  })
})

describe('validateSource', () => {
  it('accepts a valid YouTube id and drops extra fields', () => {
    expect(validateSource({ type: 'youtube', id: 'dQw4w9WgXcQ' })).toEqual({ type: 'youtube', id: 'dQw4w9WgXcQ' })
  })
  it('rejects a malformed YouTube id', () => {
    expect(validateSource({ type: 'youtube', id: 'short' })).toBeNull()
    expect(validateSource({ type: 'youtube', id: '"><script>alert(1)' })).toBeNull()
  })
  it('requires a safe url for url and hls', () => {
    expect(validateSource({ type: 'url', url: 'https://cdn.example.com/a.mp4' })).not.toBeNull()
    expect(validateSource({ type: 'hls', url: 'https://cdn.example.com/a.m3u8' })).not.toBeNull()
    expect(validateSource({ type: 'url', url: 'https://127.0.0.1/a.mp4' })).toBeNull()
    expect(validateSource({ type: 'url' })).toBeNull()
  })
  it('requires name, size and positive duration for files, and sanitizes the name', () => {
    expect(validateSource({ type: 'file', name: 'movie\u0000.mp4', size: 100, duration: 60 })).toEqual({
      type: 'file',
      name: 'movie .mp4',
      size: 100,
      duration: 60,
    })
    expect(validateSource({ type: 'file', name: 'a.mp4', size: 100 })).toBeNull()
    expect(validateSource({ type: 'file', name: 'a.mp4', size: 100, duration: 0 })).toBeNull()
  })
  it('rejects garbage', () => {
    expect(validateSource(null)).toBeNull()
    expect(validateSource({ type: 'nope' })).toBeNull()
  })
})
