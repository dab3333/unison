import {
  decideDrift,
  derivePosition,
  pickClockOffset,
  type ClientMessage,
  type ClockSample,
  type RoomState,
  type ServerMessage,
  type Source,
} from '@unison/shared'
import type { Player } from '../player/Player'

/** Player events fired within this window after we drive the player ourselves are echoes, not user actions. */
const IGNORE_MS = 400

export interface SyncDeps {
  send(m: ClientMessage): void
  now(): number
  onSource(s: Source | null): void
  onBlocked(): void
  onMismatch(i: { expected: number; actual: number }): void
  onState?(s: RoomState): void
}

export class SyncClient {
  state: RoomState | null = null
  offset = 0 // serverNow = clientNow + offset
  userOffset = 0 // seconds, per-client correction for a different local file
  private player: Player | null = null
  private ignoreUntil = 0
  private samples: ClockSample[] = []
  private sourceKey = 'null'

  constructor(private d: SyncDeps) {}

  handleServer(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        this.offset = m.serverTime - this.d.now()
        this.state = null // a welcome is authoritative for a (re)connection: reset the version guard
        this.setState(m.state)
        break
      case 'pong':
        this.samples = [...this.samples, { t0: m.t0, t1: this.d.now(), serverTime: m.serverTime }].slice(-5)
        this.offset = pickClockOffset(this.samples)
        this.reconcile()
        break
      case 'state':
      case 'heartbeat':
        this.setState(m.state)
        break
      case 'error':
        if (m.code === 'forbidden' || m.code === 'stale') this.reconcile()
        break
    }
  }

  startClockSync(): void {
    this.samples = []
    for (let i = 0; i < 5; i++) this.d.send({ type: 'ping', t0: this.d.now() })
  }

  attachPlayer(p: Player): void {
    this.player = p
    const live = () => this.player === p
    p.on('ready', () => {
      if (!live()) return
      this.checkDuration()
      this.reconcile()
    })
    p.on('play', () => live() && this.onLocal('play'))
    p.on('pause', () => live() && this.onLocal('pause'))
    p.on('seek', () => live() && this.onLocal('seek'))
    p.on('buffering', (v) => live() && this.d.send({ type: 'buffering', value: !!v }))
    p.on('blocked', () => live() && this.d.onBlocked())
    this.reconcile()
  }

  setUserOffset(seconds: number): void {
    this.userOffset = seconds
    this.reconcile()
  }

  reconcile(): void {
    const p = this.player
    const s = this.state
    if (!p || !s || !s.source) return
    const expected = this.expected(s)
    const act = decideDrift(p.getTime(), expected)
    if (s.isPlaying) {
      if (!p.isPlaying()) {
        this.quiet()
        p.seek(expected)
        p.setRate(1)
        p.play()
      } else if (act.kind === 'seek') {
        this.quiet()
        p.seek(act.to)
        p.setRate(1)
      } else {
        p.setRate(act.kind === 'rate' ? act.rate : 1)
      }
    } else {
      if (p.isPlaying()) {
        this.quiet()
        p.pause()
      }
      p.setRate(1)
      if (act.kind !== 'none') {
        this.quiet()
        p.seek(expected)
      }
    }
  }

  private expected(s: RoomState): number {
    return derivePosition(s, this.d.now() + this.offset) + this.userOffset
  }

  private quiet(): void {
    this.ignoreUntil = this.d.now() + IGNORE_MS
  }

  private setState(s: RoomState): void {
    if (this.state && s.version < this.state.version) return
    this.state = s
    this.d.onState?.(s)
    const key = JSON.stringify(s.source)
    if (key !== this.sourceKey) {
      this.sourceKey = key
      this.player = null // the page builds a new player for the new source
      this.d.onSource(s.source)
    }
    this.reconcile()
  }

  private onLocal(kind: 'play' | 'pause' | 'seek'): void {
    if (this.d.now() < this.ignoreUntil || !this.player) return
    this.d.send({
      type: 'control',
      version: this.state?.version ?? 0,
      action: kind,
      position: Math.max(0, this.player.getTime() - this.userOffset),
    })
  }

  private checkDuration(): void {
    const src = this.state?.source
    if (!this.player || src?.type !== 'file' || src.duration === undefined) return
    const actual = this.player.getDuration()
    if (Number.isFinite(actual) && Math.abs(actual - src.duration) > 1) {
      this.d.onMismatch({ expected: src.duration, actual })
    }
  }
}
