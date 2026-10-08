import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createYouTubeAdapter, loadYouTubeApi, YouTubeAdapter,
  type YTNamespace, type YTPlayerLike, type YTPlayerOptions,
} from '../src/player/YouTubeAdapter'

afterEach(() => { vi.useRealTimers() })

function fakeEnv() {
  const scripts: { src: string; onerror: ((e?: unknown) => void) | null }[] = []
  const doc = {
    createElement: () => { const s = { src: '', onerror: null as ((e?: unknown) => void) | null }; scripts.push(s); return s },
    head: { appendChild: () => {} },
  }
  const win: { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } = {}
  return { scripts, doc, win }
}

describe('loadYouTubeApi', () => {
  it('rejects on script error and a second call retries and can succeed', async () => {
    const { scripts, doc, win } = fakeEnv()
    const first = loadYouTubeApi({ doc, win })
    scripts[0].onerror!()
    await expect(first).rejects.toThrow(/failed to load/)
    const second = loadYouTubeApi({ doc, win })
    expect(scripts).toHaveLength(2)
    win.YT = { Player: class {} as never }
    win.onYouTubeIframeAPIReady!()
    await expect(second).resolves.toBe(win.YT)
  })

  it('rejects on timeout and resets the cache', async () => {
    vi.useFakeTimers()
    const { scripts, doc, win } = fakeEnv()
    const p = loadYouTubeApi({ doc, win, timeoutMs: 10_000 })
    const assertion = expect(p).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    loadYouTubeApi({ doc, win }).catch(() => {})
    expect(scripts).toHaveLength(2)
  })

  it('still invokes a pre-existing onYouTubeIframeAPIReady callback', async () => {
    const { doc, win } = fakeEnv()
    const previous = vi.fn()
    win.onYouTubeIframeAPIReady = previous
    const p = loadYouTubeApi({ doc, win })
    win.YT = { Player: class {} as never }
    win.onYouTubeIframeAPIReady!()
    await p
    expect(previous).toHaveBeenCalledTimes(1)
  })
})

describe('createYouTubeAdapter failure paths', () => {
  function setup() {
    const destroy = vi.fn()
    let events!: YTPlayerOptions['events']
    class FakePlayer implements YTPlayerLike {
      constructor(_el: HTMLElement, o: YTPlayerOptions) { events = o.events }
      playVideo() {}
      pauseVideo() {}
      seekTo() {}
      getCurrentTime() { return 0 }
      getDuration() { return 0 }
      setPlaybackRate() {}
      getAvailablePlaybackRates() { return [1] }
      getPlayerState() { return -1 }
      destroy = destroy
    }
    const loadApi = async (): Promise<YTNamespace> => ({ Player: FakePlayer })
    return { destroy, loadApi, events: () => events }
  }
  const el = {} as HTMLElement

  it('rejects with the code on player error and destroys the player, leaving no timers', async () => {
    vi.useFakeTimers()
    const { destroy, loadApi, events } = setup()
    const p = createYouTubeAdapter(el, 'x', { loadApi })
    const assertion = expect(p).rejects.toThrow(/150/)
    await vi.advanceTimersByTimeAsync(0)
    events().onError({ data: 150 })
    await assertion
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects when onReady never fires, destroying the player', async () => {
    vi.useFakeTimers()
    const { destroy, loadApi } = setup()
    const p = createYouTubeAdapter(el, 'x', { loadApi, readyTimeoutMs: 15_000 })
    const assertion = expect(p).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a late onReady after rejection is harmless', async () => {
    vi.useFakeTimers()
    const { loadApi, events } = setup()
    const p = createYouTubeAdapter(el, 'x', { loadApi })
    const assertion = expect(p).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    events().onError({ data: 2 })
    await assertion
    expect(() => events().onReady()).not.toThrow()
    expect(() => events().onStateChange({ data: 1 })).not.toThrow()
  })

  it('resolves normally when ready fires', async () => {
    vi.useFakeTimers()
    const { loadApi, events } = setup()
    const p = createYouTubeAdapter(el, 'x', { loadApi })
    await vi.advanceTimersByTimeAsync(0)
    events().onReady()
    await expect(p).resolves.toBeInstanceOf(YouTubeAdapter)
  })

  it('reports a player error after it became ready as an error event', async () => {
    vi.useFakeTimers()
    const { destroy, loadApi, events } = setup()
    const p = createYouTubeAdapter(el, 'x', { loadApi })
    await vi.advanceTimersByTimeAsync(0)
    events().onReady()
    const adapter = await p
    const cb = vi.fn(); adapter.on('error', cb)
    events().onError({ data: 150 })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe('createYouTubeAdapter player options', () => {
  it('asks YouTube for a player that fills its container (the default is a fixed 640x390 iframe)', async () => {
    let opts!: YTPlayerOptions
    class FakePlayer implements YTPlayerLike {
      constructor(_el: HTMLElement, o: YTPlayerOptions) { opts = o }
      playVideo() {}
      pauseVideo() {}
      seekTo() {}
      getCurrentTime() { return 0 }
      getDuration() { return 0 }
      setPlaybackRate() {}
      getAvailablePlaybackRates() { return [1] }
      getPlayerState() { return -1 }
      destroy() {}
    }
    const p = createYouTubeAdapter({} as HTMLElement, 'abc', { loadApi: async () => ({ Player: FakePlayer }) })
    await new Promise((r) => setTimeout(r, 0))
    opts.events.onReady()
    await p
    expect(opts.width).toBe('100%')
    expect(opts.height).toBe('100%')
  })
})

describe('createYouTubeAdapter player vars', () => {
  it("never turns on YouTube's own controls, keyboard shortcuts or fullscreen button (our bar is the only control set)", async () => {
    let opts!: YTPlayerOptions
    class FakePlayer implements YTPlayerLike {
      constructor(_el: HTMLElement, o: YTPlayerOptions) { opts = o }
      playVideo() {}
      pauseVideo() {}
      seekTo() {}
      getCurrentTime() { return 0 }
      getDuration() { return 0 }
      setPlaybackRate() {}
      getAvailablePlaybackRates() { return [1] }
      getPlayerState() { return -1 }
      destroy() {}
    }
    const p = createYouTubeAdapter({} as HTMLElement, 'abc', { loadApi: async () => ({ Player: FakePlayer }) })
    await new Promise((r) => setTimeout(r, 0))
    opts.events.onReady()
    await p
    expect(opts.playerVars).toMatchObject({ controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, iv_load_policy: 3 })
  })
})

describe('YouTubeAdapter.destroy', () => {
  it('clears the poll timer and destroys the YT player', () => {
    vi.useFakeTimers()
    const destroy = vi.fn()
    const yt: YTPlayerLike = {
      playVideo() {}, pauseVideo() {}, seekTo() {},
      getCurrentTime: () => 0, getDuration: () => 0,
      setPlaybackRate() {}, getAvailablePlaybackRates: () => [1], getPlayerState: () => -1, destroy,
    }
    const a = new YouTubeAdapter(yt)
    expect(vi.getTimerCount()).toBe(1)
    a.destroy()
    expect(vi.getTimerCount()).toBe(0)
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
