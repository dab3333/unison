import { describe, it, expect, vi } from 'vitest'
import { runPlayerContract } from './playerContract'
import { HtmlVideoAdapter, type VideoLike } from '../src/player/HtmlVideoAdapter'

class FakeVideo extends EventTarget implements VideoLike {
  paused = true
  playbackRate = 1
  duration = 100
  blockNext = false
  private t = 0
  get currentTime() { return this.t }
  set currentTime(v: number) {
    this.t = v
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')))
  }
  play(): Promise<void> {
    if (this.blockNext) {
      this.blockNext = false
      return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
    }
    this.paused = false
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

runPlayerContract('HtmlVideoAdapter', () => {
  const video = new FakeVideo()
  const player = new HtmlVideoAdapter(video)
  return {
    player,
    sim: {
      userPlay: () => void video.play(),
      userPause: () => video.pause(),
      userSeek: (to) => { video.currentTime = to },
      bufferStart: () => void video.dispatchEvent(new Event('waiting')),
      bufferEnd: () => void video.dispatchEvent(new Event('playing')),
      ready: () => void video.dispatchEvent(new Event('canplay')),
      blockNextPlay: () => { video.blockNext = true },
      setDuration: (n) => { video.duration = n },
    },
  }
})

describe('HtmlVideoAdapter buffering', () => {
  it('clears buffering on canplay, since playing never fires while paused', () => {
    const video = new FakeVideo()
    const player = new HtmlVideoAdapter(video)
    const cb = vi.fn(); player.on('buffering', cb)
    video.dispatchEvent(new Event('waiting'))
    video.dispatchEvent(new Event('canplay'))
    expect(cb.mock.calls).toEqual([[true], [false]])
  })
})
