import type { Player, PlayerEvent } from './Player'

export interface YTPlayerLike {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  setPlaybackRate(rate: number): void
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

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayerLike }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<NonNullable<Window['YT']>> | null = null
function loadApi(): Promise<NonNullable<Window['YT']>> {
  apiPromise ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT)
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!)
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return apiPromise
}

export async function createYouTubeAdapter(container: HTMLElement, videoId: string, controls: boolean): Promise<YouTubeAdapter> {
  const YT = await loadApi()
  return new Promise((resolve) => {
    let adapter!: YouTubeAdapter
    const yt = new YT.Player(container, {
      videoId,
      playerVars: { controls: controls ? 1 : 0, disablekb: controls ? 0 : 1, playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { adapter.onReady(); resolve(adapter) },
        onStateChange: (e: { data: number }) => adapter.onStateChange(e.data),
        onAutoplayBlocked: () => adapter.onAutoplayBlocked(),
      },
    })
    adapter = new YouTubeAdapter(yt)
  })
}
