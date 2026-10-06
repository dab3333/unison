import type { Player, PlayerEvent } from './Player'

export interface YTPlayerLike {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  setPlaybackRate(rate: number): void
  getAvailablePlaybackRates(): number[]
  getPlayerState(): number
  destroy(): void
}
type Handler = (v?: boolean) => void

// YouTube player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
const PLAYING = 1

export class YouTubeAdapter implements Player {
  private handlers: Partial<Record<PlayerEvent, Handler[]>> = {}
  private wasPlaying = false
  private lastTime = 0
  private lastAt: number
  private lastPlaying = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private yt: YTPlayerLike,
    private now: () => number = Date.now,
    pollMs = 500,
  ) {
    this.lastAt = now()
    if (pollMs > 0) this.timer = setInterval(() => this.pollForSeek(), pollMs)
  }

  onReady(): void { this.emit('ready') }
  onAutoplayBlocked(): void { this.emit('blocked') }
  /** A player error after creation (e.g. the video was removed or made private mid-session). */
  onPlayerError(): void { this.emit('error') }

  onStateChange(state: number): void {
    if (state === PLAYING) {
      this.emit('buffering', false)
      if (!this.wasPlaying) {
        this.wasPlaying = true
        this.emit('play')
      }
    } else if (state === 2 || state === 0) {
      this.wasPlaying = false
      this.emit('pause')
    } else if (state === 3) {
      this.emit('buffering', true)
    }
  }

  /** The IFrame API has no seek event, so detect jumps that playback progress cannot explain. */
  pollForSeek(): void {
    const t = this.yt.getCurrentTime()
    const at = this.now()
    const playing = this.yt.getPlayerState() === PLAYING
    const expected = playing && this.lastPlaying ? this.lastTime + (at - this.lastAt) / 1000 : this.lastTime
    if (Math.abs(t - expected) > 1.5) this.emit('seek')
    this.lastTime = t
    this.lastAt = at
    this.lastPlaying = playing
  }

  play(): void { this.yt.playVideo() }
  pause(): void { this.yt.pauseVideo() }
  seek(seconds: number): void {
    this.yt.seekTo(seconds, true)
    this.lastTime = seconds
    this.lastAt = this.now()
  }
  getTime(): number { return this.yt.getCurrentTime() }
  getDuration(): number { return this.yt.getDuration() }
  setRate(rate: number): void { this.yt.setPlaybackRate(rate) }
  /** The IFrame API silently ignores rates it does not list (typically only 0.25 steps, so no 0.95/1.05 nudges). */
  supportsRate(rate: number): boolean { return rate === 1 || this.yt.getAvailablePlaybackRates().includes(rate) }
  isPlaying(): boolean { return this.yt.getPlayerState() === PLAYING }
  on(event: PlayerEvent, cb: Handler): void { (this.handlers[event] ??= []).push(cb) }
  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.handlers = {}
    this.yt.destroy()
  }
  private emit(event: PlayerEvent, value?: boolean): void {
    this.handlers[event]?.forEach((h) => h(value))
  }
}

export interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayerLike
}
export interface YTPlayerOptions {
  videoId: string
  // YouTube injects a fixed 640x390 iframe unless told otherwise; 100% makes it fill the sized container.
  width: string
  height: string
  playerVars: Record<string, number>
  events: {
    onReady: () => void
    onStateChange: (e: { data: number }) => void
    onAutoplayBlocked: () => void
    onError: (e: { data: number }) => void
  }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

interface ScriptLike { src: string; onerror: ((e?: unknown) => void) | null }
export interface LoaderDeps {
  doc?: { createElement(tag: 'script'): ScriptLike; head: { appendChild(s: ScriptLike): unknown } }
  win?: { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
  timeoutMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

// Cached per window object; cleared on failure so a later call can retry.
const apiCache = new WeakMap<object, Promise<YTNamespace>>()

export function loadYouTubeApi(deps: LoaderDeps = {}): Promise<YTNamespace> {
  const win = deps.win ?? window
  const cached = apiCache.get(win)
  if (cached) return cached
  const doc = deps.doc ?? (document as unknown as NonNullable<LoaderDeps['doc']>)
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  const timeoutMs = deps.timeoutMs ?? 10_000
  const promise = new Promise<YTNamespace>((resolve, reject) => {
    if (win.YT?.Player) return resolve(win.YT)
    let timer: unknown
    const fail = (err: Error) => {
      clearTimer(timer)
      if (apiCache.get(win) === promise) apiCache.delete(win)
      reject(err)
    }
    const previous = win.onYouTubeIframeAPIReady
    win.onYouTubeIframeAPIReady = () => {
      clearTimer(timer)
      resolve(win.YT!)
      previous?.()
    }
    timer = setTimer(() => fail(new Error('YouTube API load timed out')), timeoutMs)
    const s = doc.createElement('script')
    s.onerror = () => fail(new Error('YouTube API failed to load'))
    s.src = 'https://www.youtube.com/iframe_api'
    doc.head.appendChild(s)
  })
  apiCache.set(win, promise)
  return promise
}

export interface CreateOptions {
  loadApi?: () => Promise<YTNamespace>
  readyTimeoutMs?: number
}

export async function createYouTubeAdapter(
  container: HTMLElement,
  videoId: string,
  controls: boolean,
  opts: CreateOptions = {},
): Promise<YouTubeAdapter> {
  const YT = await (opts.loadApi ?? loadYouTubeApi)()
  return new Promise((resolve, reject) => {
    let adapter: YouTubeAdapter | undefined
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      adapter?.destroy()
      reject(err)
    }
    const yt = new YT.Player(container, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { controls: controls ? 1 : 0, disablekb: controls ? 0 : 1, playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          if (settled || !adapter) return
          settled = true
          clearTimeout(timer)
          adapter.onReady()
          resolve(adapter)
        },
        onStateChange: (e) => adapter?.onStateChange(e.data),
        onAutoplayBlocked: () => adapter?.onAutoplayBlocked(),
        onError: (e) => {
          if (settled) adapter?.onPlayerError()
          else fail(new Error(`YouTube player error ${e.data}`))
        },
      },
    })
    adapter = new YouTubeAdapter(yt)
    timer = setTimeout(() => fail(new Error('YouTube player timed out before becoming ready')), opts.readyTimeoutMs ?? 15_000)
  })
}
