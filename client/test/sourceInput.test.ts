import { describe, it, expect } from 'vitest'
import { parseSourceInput } from '../src/lib/sourceInput'

const yt = { ok: true, source: { type: 'youtube', id: 'dQw4w9WgXcQ' } }

describe('parseSourceInput', () => {
  it('parses the common YouTube URL shapes', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      '  https://youtu.be/dQw4w9WgXcQ  ',
    ]) expect(parseSourceInput(url)).toEqual(yt)
  })
  it('rejects a YouTube link with a bad id', () => {
    expect(parseSourceInput('https://youtu.be/short').ok).toBe(false)
    expect(parseSourceInput('https://www.youtube.com/watch').ok).toBe(false)
  })
  it('detects HLS playlists and plain video URLs', () => {
    expect(parseSourceInput('https://cdn.example.com/live/master.m3u8')).toEqual({
      ok: true, source: { type: 'hls', url: 'https://cdn.example.com/live/master.m3u8' },
    })
    expect(parseSourceInput('https://cdn.example.com/movie.mp4')).toEqual({
      ok: true, source: { type: 'url', url: 'https://cdn.example.com/movie.mp4' },
    })
  })
  it('rejects non-https, private hosts and non-URLs with a helpful reason', () => {
    expect(parseSourceInput('http://cdn.example.com/a.mp4')).toMatchObject({ ok: false })
    expect(parseSourceInput('https://192.168.1.5/a.mp4')).toMatchObject({ ok: false })
    expect(parseSourceInput('hello there')).toMatchObject({ ok: false, reason: expect.stringContaining('https://') })
  })
})
