// Deterministic sync simulation (spec section 8): the real server Room (with its SyncEngine) and real SyncClients,
// connected by a fake network with 50-500ms one-way jitter, on one virtual clock. No timers, no sleeping.
import { describe, it, expect } from 'vitest'
import { derivePosition, type ClientMessage, type RoomSettings, type ServerMessage, type Source } from '@unison/shared'
import { Room, type Conn } from '../../server/src/room'
import { SyncClient } from '../src/sync/syncClient'
import type { Player, PlayerEvent } from '../src/player/Player'

/** Seeded PRNG (mulberry32), so every run sees the same jitter. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

class Sim {
  t = 1_000_000
  private q: { at: number; seq: number; fn: () => void }[] = []
  private seq = 0
  schedule(ms: number, fn: () => void): number {
    const id = ++this.seq
    this.q.push({ at: this.t + Math.max(0, ms), seq: id, fn })
    return id
  }
  cancel(id: unknown) { this.q = this.q.filter((e) => e.seq !== id) }
  runUntil(end: number) {
    for (;;) {
      let next = -1
      for (let i = 0; i < this.q.length; i++) {
        const e = this.q[i]!, n = this.q[next]
        if (e.at <= end && (!n || e.at < n.at || (e.at === n.at && e.seq < n.seq))) next = i
      }
      if (next < 0) break
      const [e] = this.q.splice(next, 1)
      this.t = e!.at
      e!.fn()
    }
    this.t = end
  }
}

/** One direction of a WebSocket: random latency, but in order (TCP). */
function link(sim: Sim, rand: () => number) {
  let last = 0
  return (fn: () => void) => {
    const at = Math.max(last, sim.t + 50 + rand() * 450)
    last = at
    sim.schedule(at - sim.t, fn)
  }
}

/** A player driven by the virtual clock, with a slightly wrong playback speed (drift). */
class SimPlayer implements Player {
  private pos = 0
  private at: number
  private playing = false
  private rate = 1
  private handlers: Partial<Record<PlayerEvent, Array<(v?: boolean) => void>>> = {}
  constructor(private sim: Sim, private speedError: number) { this.at = sim.t }
  private settle() { this.pos = this.getTime(); this.at = this.sim.t }
  getTime() { return this.playing ? this.pos + ((this.sim.t - this.at) / 1000) * this.rate * this.speedError : this.pos }
  play() { this.settle(); this.playing = true; this.emit('play') }
  pause() { this.settle(); this.playing = false; this.emit('pause') }
  seek(s: number) { this.pos = s; this.at = this.sim.t; this.emit('seek') }
  setRate(r: number) { this.settle(); this.rate = r }
  getDuration() { return 3600 }
  isPlaying() { return this.playing }
  on(e: PlayerEvent, cb: (v?: boolean) => void) { (this.handlers[e] ??= []).push(cb) }
  destroy() { this.handlers = {} }
  emit(e: PlayerEvent) { this.handlers[e]?.forEach((h) => h()) }
}

const settings: RoomSettings = { controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true }
const source: Source = { type: 'url', url: 'https://example.com/movie.mp4', duration: 3600 }

function setup() {
  const sim = new Sim()
  const rand = rng(20260929)
  let ids = 0
  const room = new Room('room-1', 'sim-room', 'host', settings, [], {
    now: () => sim.t, nextId: () => `id-${++ids}`, hasPassword: false, verifyPassword: () => true,
    persist: { ban: () => {}, saveSettings: () => {} },
  })
  const tick = () => { room.tick(); sim.schedule(1000, tick) }
  sim.schedule(1000, tick)

  // host plus three viewers; each has its own clock skew and a player that runs a bit fast or slow
  const specs = [
    { id: 'host', skew: -3_000, speed: 1.002 },
    { id: 'v1', skew: 1_500, speed: 0.997 },
    { id: 'v2', skew: 7_000, speed: 1.003 },
    { id: 'v3', skew: -12_000, speed: 0.998 },
  ]
  const clients = specs.map((spec) => {
    const up = link(sim, rand)
    const down = link(sim, rand)
    const c = { id: spec.id, player: null as SimPlayer | null, sync: null as unknown as SyncClient }
    c.sync = new SyncClient({
      send: (m: ClientMessage) => up(() => room.handle(`conn-${spec.id}`, m)),
      now: () => sim.t + spec.skew,
      canControl: () => spec.id === 'host',
      onSource: (s) => {
        c.player = null
        if (!s) return
        const p = new SimPlayer(sim, spec.speed)
        sim.schedule(150, () => { c.player = p; c.sync.attachPlayer(p) }) // the player takes a moment to load
      },
      onBlocked: () => {}, onMismatch: () => {},
      setTimer: (fn, ms) => sim.schedule(ms, fn),
      clearTimer: (h) => sim.cancel(h),
    })
    const conn: Conn = {
      id: `conn-${spec.id}`, ipHash: `ip-${spec.id}`,
      send: (m: ServerMessage) => down(() => {
        c.sync.handleServer(m)
        if (m.type === 'welcome') {
          c.sync.startClockSync() // as useRoom does: 5 pings at join, again every 60s
          const resync = () => { c.sync.startClockSync(); sim.schedule(60_000, resync) }
          sim.schedule(60_000, resync)
        }
      }),
      close: () => {},
    }
    room.join(conn, { id: spec.id, nickname: spec.id, isGuest: spec.id !== 'host' })
    return c
  })
  const roomPos = () => derivePosition(room.engine.state, sim.t)
  const worstError = () => Math.max(...clients.map((c) => Math.abs((c.player?.getTime() ?? -1e9) - roomPos())))
  return { sim, room, clients, host: clients[0]!, roomPos, worstError }
}

describe('sync simulation: 4 clients, 50-500ms jitter, skewed clocks, drifting players', () => {
  it('converges within 0.5s after a seek and stays in tolerance for 10 simulated minutes', () => {
    const { sim, room, host, worstError } = setup()
    const start = sim.t
    // host picks a source (the page sends setSource directly, as Room.tsx does), then presses play on their player
    room.handle('conn-host', { type: 'control', version: 0, action: 'setSource', source })
    sim.runUntil(start + 2_000)
    expect(host.player).not.toBeNull()
    host.player!.play() // a user play: outside any echo window, so it is reported
    sim.runUntil(start + 12_000)
    expect(room.engine.state.isPlaying).toBe(true)

    // host scrubs to 25:00
    host.player!.seek(1500)
    const seekAt = sim.t
    sim.runUntil(seekAt + 1_100) // at most 500ms up + 500ms down for the new state to reach everyone
    expect(room.engine.state.position).toBeCloseTo(1500, 0)
    sim.runUntil(seekAt + 1_600)
    expect(worstError()).toBeLessThan(0.5)

    // ten minutes of playback with drift, heartbeats, jitter and periodic clock re-sync
    let worst = 0
    for (let s = 1; s <= 600; s++) {
      sim.runUntil(seekAt + 1_600 + s * 1000)
      worst = Math.max(worst, worstError())
    }
    expect(room.engine.state.isPlaying).toBe(true)
    console.log(`sync simulation: worst error over 10 minutes ${worst.toFixed(3)}s`)
    expect(worst).toBeLessThan(0.5)
  })
})
