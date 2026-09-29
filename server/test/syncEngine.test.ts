import { describe, it, expect } from 'vitest'
import { SyncEngine } from '../src/syncEngine'
import type { Source } from '@unison/shared'

const file: Source = { type: 'file', name: 'a.mp4', size: 1, duration: 100 }

function setup() {
  let t = 1_000
  const engine = new SyncEngine(() => t)
  return { engine, advance: (ms: number) => (t += ms) }
}
function withSource() {
  const s = setup()
  s.engine.apply({ action: 'setSource', source: file }, 0, false)
  return s
}

describe('SyncEngine', () => {
  it('starts empty and paused at version 0', () => {
    const { engine } = setup()
    expect(engine.state).toMatchObject({ source: null, isPlaying: false, position: 0, version: 0 })
  })

  it('setSource resets position and pauses, bumping version', () => {
    const { engine } = setup()
    const r = engine.apply({ action: 'setSource', source: file }, 0, false)
    expect(r.ok && r.state).toMatchObject({ source: file, isPlaying: false, position: 0, version: 1 })
  })

  it('play, seek and pause update state and version', () => {
    const { engine, advance } = withSource()
    engine.apply({ action: 'play', position: 5 }, 1, false)
    advance(2000)
    expect(engine.currentPosition()).toBeCloseTo(7)
    engine.apply({ action: 'seek', position: 50 }, 2, false)
    expect(engine.state).toMatchObject({ isPlaying: true, position: 50, version: 3 })
    engine.apply({ action: 'pause', position: 51 }, 3, false)
    expect(engine.state).toMatchObject({ isPlaying: false, position: 51, version: 4 })
  })

  it('rejects stale versions unless stale writes are allowed', () => {
    const { engine } = withSource()
    engine.apply({ action: 'play', position: 1 }, 1, false)
    expect(engine.apply({ action: 'pause', position: 2 }, 0, false)).toEqual({ ok: false, code: 'stale' })
    expect(engine.apply({ action: 'pause', position: 2 }, 0, true).ok).toBe(true)
  })

  it('rejects play/seek/pause with no source loaded', () => {
    const { engine } = setup()
    expect(engine.apply({ action: 'play', position: 0 }, 0, false)).toEqual({ ok: false, code: 'bad_request' })
  })

  it('rejects invalid positions and leaves state untouched (review focus 4)', () => {
    const { engine } = withSource()
    const before = engine.state
    for (const position of [-1, Infinity, NaN, undefined, 101.5]) {
      expect(engine.apply({ action: 'seek', position: position as number }, 1, false)).toEqual({
        ok: false,
        code: 'bad_request',
      })
    }
    expect(engine.state).toBe(before)
  })

  it('accepts a position up to 1s past the duration (end-of-video jitter)', () => {
    const { engine } = withSource()
    expect(engine.apply({ action: 'seek', position: 100.9 }, 1, false).ok).toBe(true)
  })

  it('rejects setSource without a source', () => {
    const { engine } = setup()
    expect(engine.apply({ action: 'setSource' }, 0, false)).toEqual({ ok: false, code: 'bad_request' })
  })

  it('setPlaying(false) captures the derived position; no-op when unchanged', () => {
    const { engine, advance } = withSource()
    engine.apply({ action: 'play', position: 10 }, 1, false)
    advance(3000)
    const paused = engine.setPlaying(false)
    expect(paused).toMatchObject({ isPlaying: false, version: 3 })
    expect(paused.position).toBeCloseTo(13)
    expect(engine.setPlaying(false).version).toBe(3)
  })
})
