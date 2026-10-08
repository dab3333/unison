import { describe, it, expect } from 'vitest'
import { createAutoHide } from '../src/lib/autoHide'

function setup(delayMs = 3000) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = []
  const changes: boolean[] = []
  const hide = createAutoHide({
    delayMs,
    onChange: (v) => changes.push(v),
    setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1 },
    clearTimer: (h) => { timers[h as number]!.live = false },
  })
  /** Fire the most recent live timer, as if the delay elapsed. */
  const elapse = () => { const t = [...timers].reverse().find((x) => x.live); if (t) { t.live = false; t.fn() } }
  return { hide, changes, timers, elapse }
}

describe('createAutoHide', () => {
  it('starts visible and hides after the idle delay', () => {
    const { hide, changes, timers, elapse } = setup()
    expect(hide.visible).toBe(true)
    expect(timers.at(-1)?.ms).toBe(3000)
    elapse()
    expect(hide.visible).toBe(false)
    expect(changes).toEqual([false])
  })

  it('activity restarts the countdown instead of hiding', () => {
    const { hide, timers, elapse, changes } = setup()
    hide.activity()
    hide.activity()
    expect(timers.filter((t) => t.live)).toHaveLength(1) // only the newest countdown is live
    expect(changes).toEqual([]) // no flicker while already visible
    elapse()
    expect(hide.visible).toBe(false)
  })

  it('activity shows the controls again once hidden, then hides them again', () => {
    const { hide, changes, elapse } = setup()
    elapse()
    hide.activity()
    expect(hide.visible).toBe(true)
    elapse()
    expect(changes).toEqual([false, true, false])
  })

  it('never hides while pinned (paused), and shows them when pinned', () => {
    const { hide, changes, timers, elapse } = setup()
    elapse() // hidden
    hide.setPinned(true)
    expect(hide.visible).toBe(true)
    expect(timers.filter((t) => t.live)).toHaveLength(0)
    elapse()
    expect(hide.visible).toBe(true)
    expect(changes).toEqual([false, true])
  })

  it('unpinning (playback resumes) starts the countdown', () => {
    const { hide, elapse } = setup()
    hide.setPinned(true)
    hide.setPinned(false)
    expect(hide.visible).toBe(true)
    elapse()
    expect(hide.visible).toBe(false)
  })

  it('activity while pinned does not start a countdown', () => {
    const { hide, timers } = setup()
    hide.setPinned(true)
    hide.activity()
    expect(timers.filter((t) => t.live)).toHaveLength(0)
  })

  it('dispose cancels the countdown so nothing fires afterwards', () => {
    const { hide, changes, timers, elapse } = setup()
    hide.dispose()
    expect(timers.filter((t) => t.live)).toHaveLength(0)
    elapse()
    hide.activity()
    expect(changes).toEqual([])
  })
})
