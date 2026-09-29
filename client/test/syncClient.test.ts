import { describe, it, expect } from 'vitest'
import type { ClientMessage, RoomState, ServerMessage, Source } from '@unison/shared'
import { SyncClient } from '../src/sync/syncClient'
import type { Player, PlayerEvent } from '../src/player/Player'

class FakePlayer implements Player {
  time = 0
  playing = false
  duration = 100
  calls: string[] = []
  private handlers: Partial<Record<PlayerEvent, Array<(v?: boolean) => void>>> = {}
  play() { this.playing = true; this.calls.push('play') }
  pause() { this.playing = false; this.calls.push('pause') }
  seek(s: number) { this.time = s; this.calls.push(`seek:${s}`) }
  getTime() { return this.time }
  getDuration() { return this.duration }
  setRate(r: number) { this.calls.push(`rate:${r}`) }
  isPlaying() { return this.playing }
  on(e: PlayerEvent, cb: (v?: boolean) => void) { (this.handlers[e] ??= []).push(cb) }
  destroy() { this.handlers = {} }
  emit(e: PlayerEvent, v?: boolean) { this.handlers[e]?.forEach((h) => h(v)) }
}

const file: Source = { type: 'file', name: 'a.mp4', size: 1, duration: 100 }

function make() {
  const clock = { t: 100_000 }
  const sent: ClientMessage[] = []
  const sources: (Source | null)[] = []
  const mismatches: { expected: number; actual: number }[] = []
  let blocked = 0
  const sync = new SyncClient({
    send: (m) => sent.push(m), now: () => clock.t, onSource: (s) => sources.push(s),
    onBlocked: () => blocked++, onMismatch: (m) => mismatches.push(m),
  })
  const player = new FakePlayer()
  const state = (over: Partial<RoomState> = {}): RoomState => ({
    source: file, isPlaying: true, position: 10, rate: 1, updatedAt: clock.t, version: 1, ...over,
  })
  const welcome = (s: RoomState): ServerMessage => ({
    type: 'welcome', you: 'me', role: 'guest', state: s, members: [], chat: [], serverTime: clock.t,
    settings: { controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true, hasPassword: false },
  })
  const heartbeat = (s: RoomState): ServerMessage => ({ type: 'heartbeat', state: s, serverTime: clock.t })
  return { clock, sent, sources, mismatches, blocked: () => blocked, sync, player, state, welcome, heartbeat }
}

describe('SyncClient reconcile', () => {
  it('on attach, seeks to the derived position and plays when the room is playing', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.clock.t += 2000
    t.sync.attachPlayer(t.player)
    expect(t.player.calls).toEqual(['seek:12', 'rate:1', 'play'])
  })

  it('pauses and seeks exactly when the room is paused', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ isPlaying: false, position: 20 })))
    t.player.playing = true; t.player.time = 5
    t.sync.attachPlayer(t.player)
    expect(t.player.calls).toEqual(['pause', 'rate:1', 'seek:20'])
  })

  it('corrects drift: nothing under 0.3s, rate nudge to 2s, seek beyond', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.player.calls.length = 0
    const beat = () => t.sync.handleServer(t.heartbeat(t.state()))
    t.player.time = 10.1; beat()
    expect(t.player.calls.splice(0)).toEqual(['rate:1'])
    t.player.time = 11; beat()
    expect(t.player.calls.splice(0)).toEqual(['rate:0.95'])
    t.player.time = 9.5; beat()
    expect(t.player.calls.splice(0)).toEqual(['rate:1.05'])
    t.player.time = 14; beat()
    expect(t.player.calls.splice(0)).toEqual(['seek:10', 'rate:1'])
  })

  it('applies a per-client offset (local file that starts later)', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.player.calls.length = 0
    t.sync.setUserOffset(3)
    expect(t.player.calls).toEqual(['seek:13', 'rate:1'])
  })

  it('snaps back when the server says a local action was forbidden or stale', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.player.time = 50; t.player.calls.length = 0
    t.sync.handleServer({ type: 'error', code: 'forbidden', message: 'forbidden' })
    expect(t.player.calls).toEqual(['seek:10', 'rate:1'])
  })
})

describe('SyncClient clock offset', () => {
  it('estimates the server clock from the lowest-RTT pong', () => {
    const t = make()
    t.clock.t = 5000
    t.sync.startClockSync()
    const pings = t.sent.filter((m): m is Extract<ClientMessage, { type: 'ping' }> => m.type === 'ping')
    expect(pings).toHaveLength(5)
    for (const p of pings) {
      t.clock.t += 20
      t.sync.handleServer({ type: 'pong', t0: p.t0, serverTime: p.t0 + 1010 })
    }
    expect(t.sync.offset).toBe(1000)
  })
})

describe('SyncClient local events and ordering', () => {
  it('ignores echoes of its own actions, then reports real user actions with version and position', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.attachPlayer(t.player) // performs play() and opens the ignore window
    t.player.emit('play')
    expect(t.sent.filter((m) => m.type === 'control')).toHaveLength(0)
    t.clock.t += 500
    t.player.time = 33
    t.player.emit('pause')
    expect(t.sent.at(-1)).toEqual({ type: 'control', version: 1, action: 'pause', position: 33 })
  })

  it('subtracts the user offset from reported positions', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ isPlaying: false })))
    t.sync.attachPlayer(t.player)
    t.sync.setUserOffset(3)
    t.clock.t += 500
    t.player.time = 33
    t.player.emit('seek')
    expect(t.sent.at(-1)).toMatchObject({ action: 'seek', position: 30 })
  })

  it('ignores out-of-order state', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ version: 5 })))
    t.sync.handleServer({ type: 'state', state: t.state({ version: 3, position: 99 }) })
    expect(t.sync.state?.version).toBe(5)
    expect(t.sync.state?.position).toBe(10)
  })

  it('reports source changes once and drops the old player', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.handleServer(t.heartbeat(t.state()))
    expect(t.sources).toEqual([file])
    t.sync.attachPlayer(t.player)
    const yt: Source = { type: 'youtube', id: 'dQw4w9WgXcQ' }
    t.sync.handleServer({ type: 'state', state: t.state({ version: 2, source: yt }) })
    expect(t.sources).toEqual([file, yt])
    t.player.calls.length = 0
    t.sync.handleServer(t.heartbeat(t.state({ version: 2, source: yt })))
    expect(t.player.calls).toEqual([]) // old player is no longer driven
  })

  it('forwards buffering and blocked events', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.attachPlayer(t.player)
    t.player.emit('buffering', true)
    expect(t.sent.at(-1)).toEqual({ type: 'buffering', value: true })
    t.player.emit('blocked')
    expect(t.blocked()).toBe(1)
  })
})

describe('SyncClient file mismatch', () => {
  it('warns when a local file duration differs from the host by more than 1s', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.attachPlayer(t.player)
    t.player.duration = 100.5; t.player.emit('ready')
    expect(t.mismatches).toEqual([])
    t.player.duration = 140; t.player.emit('ready')
    expect(t.mismatches).toEqual([{ expected: 100, actual: 140 }])
  })
})

describe('SyncClient welcome and paused echo window', () => {
  it('accepts a welcome with a lower version (server restart) and drives the player', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ version: 5 })))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.player.calls.length = 0
    t.sync.handleServer(t.welcome(t.state({ version: 1, position: 40 })))
    expect(t.sync.state?.version).toBe(1)
    expect(t.player.calls).toEqual(['seek:40', 'rate:1'])
  })

  it('a welcome with the same source does not re-fire onSource or drop the player', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ version: 5 })))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.sync.handleServer(t.welcome(t.state({ version: 1 })))
    expect(t.sources).toEqual([file])
    t.player.calls.length = 0
    t.player.time = 14
    t.sync.handleServer(t.heartbeat(t.state({ version: 1 })))
    expect(t.player.calls).toEqual(['seek:10', 'rate:1'])
  })

  it('a welcome with a different source fires onSource once', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ version: 5 })))
    const yt: Source = { type: 'youtube', id: 'dQw4w9WgXcQ' }
    t.sync.handleServer(t.welcome(t.state({ version: 1, source: yt })))
    expect(t.sources).toEqual([file, yt])
  })

  it('does not swallow a real user play right after a heartbeat while paused and in sync', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ isPlaying: false, position: 20 })))
    t.player.time = 20
    t.sync.attachPlayer(t.player)
    t.clock.t += 5000
    t.sync.handleServer(t.heartbeat(t.state({ isPlaying: false, position: 20 })))
    t.player.emit('play')
    expect(t.sent.at(-1)).toMatchObject({ type: 'control', action: 'play' })
  })
})
