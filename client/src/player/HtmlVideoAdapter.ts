import type { Player, PlayerEvent } from './Player'

export interface VideoLike extends EventTarget {
  currentTime: number
  duration: number
  playbackRate: number
  readonly paused: boolean
  play(): Promise<void>
  pause(): void
}
type Handler = (v?: boolean) => void

export class HtmlVideoAdapter implements Player {
  private handlers: Partial<Record<PlayerEvent, Handler[]>> = {}
  private listeners: Array<[string, EventListener]> = []

  constructor(private video: VideoLike) {
    const on = (name: string, fn: () => void) => {
      const l: EventListener = () => fn()
      video.addEventListener(name, l)
      this.listeners.push([name, l])
    }
    on('play', () => this.emit('play'))
    on('pause', () => this.emit('pause'))
    on('seeked', () => this.emit('seek'))
    on('waiting', () => this.emit('buffering', true))
    on('playing', () => this.emit('buffering', false))
    on('canplay', () => { this.emit('buffering', false); this.emit('ready') }) // 'playing' never fires while paused, so canplay must also clear buffering
    on('loadedmetadata', () => this.emit('ready'))
  }

  play(): void {
    void this.video.play().catch((e: { name?: string }) => {
      if (e?.name === 'NotAllowedError') this.emit('blocked')
    })
  }
  pause(): void { this.video.pause() }
  seek(seconds: number): void { this.video.currentTime = seconds }
  getTime(): number { return this.video.currentTime }
  getDuration(): number { return this.video.duration }
  setRate(rate: number): void { this.video.playbackRate = rate }
  isPlaying(): boolean { return !this.video.paused }
  on(event: PlayerEvent, cb: Handler): void { (this.handlers[event] ??= []).push(cb) }
  destroy(): void {
    for (const [name, l] of this.listeners) this.video.removeEventListener(name, l)
    this.listeners = []
    this.handlers = {}
  }
  private emit(event: PlayerEvent, value?: boolean): void {
    this.handlers[event]?.forEach((h) => h(value))
  }
}
