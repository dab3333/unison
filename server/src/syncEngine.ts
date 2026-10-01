import { derivePosition, type RoomState, type Source } from '@unison/shared'

export type ControlInput = {
  action: 'play' | 'pause' | 'seek' | 'setSource'
  position?: number
  source?: Source
}
export type ApplyResult = { ok: true; state: RoomState } | { ok: false; code: 'stale' | 'bad_request' }

const BAD: ApplyResult = { ok: false, code: 'bad_request' }

export class SyncEngine {
  private s: RoomState

  constructor(private now: () => number) {
    this.s = { source: null, isPlaying: false, position: 0, rate: 1, updatedAt: now(), version: 0 }
  }

  get state(): RoomState {
    return this.s
  }

  currentPosition(): number {
    return derivePosition(this.s, this.now())
  }

  apply(input: ControlInput, clientVersion: number, allowStale: boolean): ApplyResult {
    if (!allowStale && clientVersion < this.s.version) return { ok: false, code: 'stale' }
    if (input.action === 'setSource') {
      if (!input.source) return BAD
      return this.commit({ source: input.source, isPlaying: false, position: 0 })
    }
    const p = input.position
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return BAD
    if (!this.s.source) return BAD
    const duration = this.s.source.duration
    if (duration !== undefined && p > duration + 1) return BAD
    if (input.action === 'play') return this.commit({ isPlaying: true, position: p })
    if (input.action === 'pause') return this.commit({ isPlaying: false, position: p })
    return this.commit({ position: p })
  }

  setPlaying(isPlaying: boolean): RoomState {
    if (this.s.isPlaying === isPlaying) return this.s
    return (this.commit({ isPlaying, position: this.currentPosition() }) as { ok: true; state: RoomState }).state
  }

  private commit(patch: Partial<RoomState>): ApplyResult {
    this.s = { ...this.s, ...patch, updatedAt: this.now(), version: this.s.version + 1 }
    return { ok: true, state: this.s }
  }
}
