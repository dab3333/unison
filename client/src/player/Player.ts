export type PlayerEvent = 'play' | 'pause' | 'seek' | 'buffering' | 'ready' | 'blocked'

export interface Player {
  play(): void
  pause(): void
  seek(seconds: number): void
  getTime(): number
  getDuration(): number
  setRate(rate: number): void
  isPlaying(): boolean
  on(event: PlayerEvent, cb: (value?: boolean) => void): void
  destroy(): void
}
