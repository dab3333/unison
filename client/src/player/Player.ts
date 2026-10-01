/** 'error': the media failed to load or play after the player was created (network, unsupported, removed). */
export type PlayerEvent = 'play' | 'pause' | 'seek' | 'buffering' | 'ready' | 'blocked' | 'error'

export interface Player {
  play(): void
  pause(): void
  seek(seconds: number): void
  getTime(): number
  getDuration(): number
  setRate(rate: number): void
  /** Optional: false when setRate(rate) would be ignored (YouTube offers only a few rates). Absent means any rate works. */
  supportsRate?(rate: number): boolean
  isPlaying(): boolean
  on(event: PlayerEvent, cb: (value?: boolean) => void): void
  destroy(): void
}
