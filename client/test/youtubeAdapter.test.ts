import { describe, it, expect, vi } from 'vitest'
import { runPlayerContract, type PlayerSim } from './playerContract'
import { YouTubeAdapter, type YTPlayerLike } from '../src/player/YouTubeAdapter'

class FakeYT implements YTPlayerLike {
  time = 0
  dur = 100
  state = -1
  blockNext = false
  adapter!: YouTubeAdapter
  playVideo() {
    if (this.blockNext) { this.blockNext = false; this.adapter.onAutoplayBlocked(); return }
    this.state = 1; this.adapter.onStateChange(1)
  }
  pauseVideo() { this.state = 2; this.adapter.onStateChange(2) }
  seekTo(s: number) { this.time = s }
  getCurrentTime() { return this.time }
  getDuration() { return this.dur }
  setPlaybackRate() {}
  rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
  getAvailablePlaybackRates() { return this.rates }
  getPlayerState() { return this.state }
  destroy() {}
}

function build(now: () => number = Date.now) {
  const yt = new FakeYT()
  const player = new YouTubeAdapter(yt, now, 0) // pollMs 0: tests call pollForSeek() themselves
  yt.adapter = player
  const sim: PlayerSim = {
    userPlay: () => { yt.state = 1; player.onStateChange(1) },
    userPause: () => { yt.state = 2; player.onStateChange(2) },
    userSeek: (to) => { yt.time = to; player.pollForSeek() },
    bufferStart: () => { yt.state = 3; player.onStateChange(3) },
    bufferEnd: () => { yt.state = 1; player.onStateChange(1) },
    ready: () => player.onReady(),
    blockNextPlay: () => { yt.blockNext = true },
    setDuration: (n) => { yt.dur = n },
    fail: () => player.onPlayerError(),
  }
  return { yt, player, sim }
}

runPlayerContract('YouTubeAdapter', () => build())

describe('YouTubeAdapter specifics', () => {
  it('only claims the playback rates YouTube actually offers', () => {
    const { yt, player } = build()
    expect(player.supportsRate(1)).toBe(true)
    expect(player.supportsRate(1.25)).toBe(true)
    expect(player.supportsRate(1.05)).toBe(false)
    expect(player.supportsRate(0.95)).toBe(false)
    yt.rates = [] // before the video loads the list can be empty; normal speed always works
    expect(player.supportsRate(1)).toBe(true)
    expect(player.supportsRate(1.05)).toBe(false)
  })

  it('does not re-emit play when buffering ends during playback', () => {
    const { player, sim } = build()
    const play = vi.fn(); player.on('play', play)
    sim.userPlay(); sim.bufferStart(); sim.bufferEnd()
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('treats the end of the video as a pause', () => {
    const { player } = build()
    const pause = vi.fn(); player.on('pause', pause)
    player.onStateChange(1); player.onStateChange(0)
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('does not report a seek for normal playback progress but does for a jump', () => {
    let t = 0
    const { yt, player, sim } = build(() => t)
    const seek = vi.fn(); player.on('seek', seek)
    sim.userPlay(); player.pollForSeek() // baseline while playing
    t += 10_000; yt.time = 10; player.pollForSeek()
    expect(seek).not.toHaveBeenCalled()
    t += 500; yt.time = 60; player.pollForSeek()
    expect(seek).toHaveBeenCalledTimes(1)
  })

  it('programmatic seek does not look like a user seek on the next poll', () => {
    const { player, sim } = build()
    const seek = vi.fn(); player.on('seek', seek)
    sim.userPlay(); player.pollForSeek()
    player.seek(45); player.pollForSeek()
    expect(seek).not.toHaveBeenCalled()
  })
})
