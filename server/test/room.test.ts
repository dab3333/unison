import { describe, it, expect } from 'vitest'
import { makeRoom, joinAs, host, user, guest, source, FakeConn } from './helpers'
import type { Room } from '../src/room'

const ctl = (room: Room, connId: string, msg: { action: 'play' | 'pause' | 'seek' | 'setSource'; position?: number; source?: unknown }) =>
  room.handle(connId, { type: 'control', version: room.engine.state.version, ...msg } as never)

function loaded(over: Parameters<typeof makeRoom>[0] = {}) {
  const ctx = makeRoom(over)
  const h = joinAs(ctx.room, host())
  const g = joinAs(ctx.room, guest())
  ctl(ctx.room, h.conn.id, { action: 'setSource', source })
  return { ...ctx, h, g }
}

describe('join and welcome', () => {
  it('sends welcome with state, members and settings, and announces members', () => {
    const { room } = makeRoom()
    const h = joinAs(room, host())
    const g = joinAs(room, guest())
    expect(h.result).toEqual({ ok: true })
    const w = g.conn.last('welcome')!
    expect(w.you).toBe('g1')
    expect(w.role).toBe('guest')
    expect(w.members.map((m) => m.nickname).sort()).toEqual(['Maya', 'Pat'])
    expect(w.settings).toMatchObject({ controlMode: 'host', hasPassword: false })
    expect(h.conn.last('members')!.members).toHaveLength(2)
    expect(room.size).toBe(2)
  })

  it('refuses guests when guests are off', () => {
    const { room } = makeRoom({ settings: { allowGuests: false } })
    expect(joinAs(room, guest()).result).toEqual({ ok: false, code: 'forbidden' })
    expect(joinAs(room, user()).result).toEqual({ ok: true })
  })

  it('enforces maxViewers but never blocks the host', () => {
    const { room } = makeRoom({ settings: { maxViewers: 2 } })
    expect(joinAs(room, user('u2')).result.ok).toBe(true)
    expect(joinAs(room, user('u3')).result.ok).toBe(true)
    expect(joinAs(room, guest()).result).toEqual({ ok: false, code: 'room_full' })
    expect(joinAs(room, host()).result.ok).toBe(true)
  })

  it('checks the password for everyone except the host', () => {
    const { room } = makeRoom({ password: 'pw' })
    expect(joinAs(room, guest('g1'), 'c1').result).toEqual({ ok: false, code: 'bad_password' })
    expect(joinAs(room, guest('g2'), 'c2', 'pw').result.ok).toBe(true)
    expect(joinAs(room, host()).result.ok).toBe(true)
  })

  it('replaces a second connection from the same identity instead of double counting (review focus 2)', () => {
    const { room } = makeRoom({ settings: { maxViewers: 2 } })
    const a = joinAs(room, user('u2'), 'c-a')
    const b = joinAs(room, user('u2'), 'c-b')
    expect(b.result).toEqual({ ok: true })
    expect(a.conn.closed?.code).toBe(4001)
    expect(room.size).toBe(1)
    room.leave('c-a') // the old socket's late close must not evict the new one
    expect(room.members().map((m) => m.id)).toEqual(['u2'])
    expect(joinAs(room, user('u3')).result.ok).toBe(true)
  })

  it('answers ping with pong and rejects a second hello', () => {
    const { room, now } = makeRoom()
    const h = joinAs(room, host())
    room.handle(h.conn.id, { type: 'ping', t0: 7 })
    expect(h.conn.last('pong')).toEqual({ type: 'pong', t0: 7, serverTime: now() })
    room.handle(h.conn.id, { type: 'hello', token: 'x' })
    expect(h.conn.last('error')?.code).toBe('bad_request')
  })
})

describe('playback control', () => {
  it('lets only the host control playback in host mode', () => {
    const { room, h, g } = loaded()
    expect(g.conn.last('state')!.state.source).toEqual(source)
    ctl(room, g.conn.id, { action: 'play', position: 0 })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    expect(room.engine.state.isPlaying).toBe(false)
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    expect(room.engine.state.isPlaying).toBe(true)
    expect(g.conn.last('state')!.state.isPlaying).toBe(true)
  })

  it('lets guests control in everyone mode, last write wins even with a stale version', () => {
    const { room, g } = loaded({ settings: { controlMode: 'everyone' } })
    room.handle(g.conn.id, { type: 'control', version: 0, action: 'play', position: 3 })
    expect(room.engine.state).toMatchObject({ isPlaying: true, position: 3 })
  })

  it('rejects stale versions from the host in host mode', () => {
    const { room, h } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(h.conn.id, { type: 'control', version: 0, action: 'pause', position: 1 })
    expect(h.conn.last('error')?.code).toBe('stale')
  })

  it('rejects invalid sources and positions with bad_request', () => {
    const { room, h } = loaded()
    ctl(room, h.conn.id, { action: 'setSource', source: { type: 'url', url: 'http://example.com/a.mp4' } })
    expect(h.conn.last('error')?.code).toBe('bad_request')
    ctl(room, h.conn.id, { action: 'seek', position: -1 })
    expect(h.conn.all('error').at(-1)?.code).toBe('bad_request')
    expect(room.engine.state.source).toEqual(source)
  })

  it('rate limits control events at 10 per 10s', () => {
    const { room, h } = loaded() // setSource was event 1
    for (let i = 0; i < 9; i++) ctl(room, h.conn.id, { action: 'seek', position: i })
    expect(h.conn.all('error')).toHaveLength(0)
    ctl(room, h.conn.id, { action: 'seek', position: 50 })
    expect(h.conn.last('error')?.code).toBe('rate_limited')
  })

  it('keeps state and chat working when the host disconnects, and restores the host role on rejoin (review focus 3)', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.leave(h.conn.id)
    expect(room.size).toBe(1)
    room.handle(g.conn.id, { type: 'chat', text: 'still here' })
    expect(g.conn.last('chat')?.message.text).toBe('still here')
    advance(5000)
    room.tick()
    expect(g.conn.last('heartbeat')?.state.isPlaying).toBe(true)
    const back = joinAs(room, host(), 'c-back')
    expect(back.conn.last('welcome')).toMatchObject({ role: 'host', state: { isPlaying: true } })
  })
})

describe('buffering', () => {
  it('auto-pauses when a member buffers and resumes when everyone is ready', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    advance(2000)
    room.handle(g.conn.id, { type: 'buffering', value: true })
    const paused = h.conn.last('state')!
    expect(paused.state.isPlaying).toBe(false)
    expect(paused.state.position).toBeCloseTo(2)
    expect(paused.holdingUp).toEqual(['g1'])
    room.handle(g.conn.id, { type: 'buffering', value: false })
    expect(h.conn.last('state')!.state.isPlaying).toBe(true)
  })

  it('resumes after 10s even if a member is still buffering', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    advance(9_999); room.tick()
    expect(room.engine.state.isPlaying).toBe(false)
    advance(1); room.tick()
    expect(room.engine.state.isPlaying).toBe(true)
  })

  it('resumes if the buffering member leaves', () => {
    const { room, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    room.leave(g.conn.id)
    expect(room.engine.state.isPlaying).toBe(true)
  })

  it('does nothing when pauseOnBuffering is off', () => {
    const { room, h, g } = loaded({ settings: { pauseOnBuffering: false } })
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    expect(room.engine.state.isPlaying).toBe(true)
  })
})

describe('chat', () => {
  it('broadcasts sanitized chat to everyone', () => {
    const { room, h, g } = loaded()
    room.handle(g.conn.id, { type: 'chat', text: '  hi\u0000 all ' })
    expect(h.conn.last('chat')?.message).toMatchObject({ nickname: 'Pat', text: 'hi all' })
  })

  it('blocks chat for non-hosts when chat is disabled', () => {
    const { room, h, g } = loaded({ settings: { chatEnabled: false } })
    room.handle(g.conn.id, { type: 'chat', text: 'hi' })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'chat', text: 'announcement' })
    expect(g.conn.last('chat')?.message.text).toBe('announcement')
  })

  it('escalates repeated rate-limit breaches: auto-mute, then disconnect', () => {
    const { room, g, h } = loaded()
    for (let i = 0; i < 8; i++) room.handle(g.conn.id, { type: 'chat', text: `m${i}` })
    expect(h.conn.last('members')!.members.find((m) => m.id === 'g1')?.muted).toBe(true)
    expect(g.conn.closed).toBeNull()
    for (let i = 0; i < 5; i++) room.handle(g.conn.id, { type: 'chat', text: 'spam' })
    expect(g.conn.closed?.code).toBe(4008)
    expect(room.size).toBe(1)
  })
})

describe('penalties survive reconnects', () => {
  const chatN = (room: Room, id: string, n: number) => { for (let i = 0; i < n; i++) room.handle(id, { type: 'chat', text: `m${i}` }) }

  it('keeps a moderator mute across leave and rejoin until unmuted', () => {
    const { room, h, g } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'mute', target: 'g1' })
    room.leave(g.conn.id)
    const back = joinAs(room, guest('g1'), 'c-new')
    room.handle(back.conn.id, { type: 'chat', text: 'hello' })
    expect(back.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'mod', op: 'unmute', target: 'g1' })
    room.handle(back.conn.id, { type: 'chat', text: 'hello' })
    expect(h.conn.last('chat')?.message.text).toBe('hello')
  })

  it('keeps a mute when the user opens a second tab', () => {
    const { room, h } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'mute', target: 'g1' })
    const tab2 = joinAs(room, guest('g1'), 'c-tab2')
    room.handle(tab2.conn.id, { type: 'chat', text: 'hello' })
    expect(tab2.conn.last('error')?.code).toBe('forbidden')
  })

  it('keeps an auto-mute across rejoin and expires it after 60s', () => {
    const { room, advance, h, g } = loaded()
    chatN(room, g.conn.id, 8)
    room.leave(g.conn.id)
    const back = joinAs(room, guest('g1'), 'c-new')
    expect(back.conn.last('members')!.members.find((m) => m.id === 'g1')?.muted).toBe(true)
    room.handle(back.conn.id, { type: 'chat', text: 'hi' })
    expect(back.conn.all('chat').filter((c) => c.message.text === 'hi')).toHaveLength(0)
    advance(60_001)
    room.handle(back.conn.id, { type: 'chat', text: 'later' })
    expect(h.conn.last('chat')?.message.text).toBe('later')
  })

  it('accumulates strikes across a reconnect', () => {
    const { room, g } = loaded()
    chatN(room, g.conn.id, 7) // 3 allowed + 4 strikes
    room.leave(g.conn.id)
    const back = joinAs(room, guest('g1'), 'c-new')
    chatN(room, back.conn.id, 8) // 3 allowed + 5 more strikes = 9 total
    expect(back.conn.closed).toBeNull()
    chatN(room, back.conn.id, 1) // 10th strike
    expect(back.conn.closed?.code).toBe(4008)
  })

  it('forgets old penalties once they have expired and the user is gone', () => {
    const { room, advance, g } = loaded()
    chatN(room, g.conn.id, 7)
    room.leave(g.conn.id)
    advance(61_000)
    room.tick()
    const back = joinAs(room, guest('g1'), 'c-new')
    chatN(room, back.conn.id, 12) // fresh: 3 allowed + 9 strikes, still connected
    expect(back.conn.closed).toBeNull()
  })
})

describe('moderation', () => {
  it('lets a promoted moderator kick a guest but not the host, and not ban', () => {
    const { room, h } = loaded()
    const mod = joinAs(room, user('u2', 'Leo'))
    const victim = joinAs(room, guest('g2', 'Sam'))
    room.handle(h.conn.id, { type: 'mod', op: 'promote', target: 'u2' })
    expect(mod.conn.last('members')!.members.find((m) => m.id === 'u2')?.role).toBe('moderator')
    room.handle(mod.conn.id, { type: 'mod', op: 'ban', target: 'g2' })
    expect(mod.conn.last('error')?.code).toBe('forbidden')
    room.handle(mod.conn.id, { type: 'mod', op: 'kick', target: 'host-1' })
    expect(mod.conn.last('error')?.code).toBe('forbidden')
    room.handle(mod.conn.id, { type: 'mod', op: 'kick', target: 'g2' })
    expect(victim.conn.closed?.code).toBe(4003)
    expect(room.members().map((m) => m.id)).not.toContain('g2')
  })

  it('bans persist, disconnect, and block rejoin by id and by IP for guests', () => {
    const { room, persisted, h, g } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'ban', target: 'g1' })
    expect(persisted.bans.sort()).toEqual(['guest:g1', 'ip:ip-c-g1'])
    expect(g.conn.closed?.code).toBe(4004)
    expect(joinAs(room, guest('g1'), 'c-new').result).toEqual({ ok: false, code: 'banned' })
    const sameIp = new FakeConn('other', 'ip-c-g1')
    expect(room.join(sameIp, guest('g9'))).toEqual({ ok: false, code: 'banned' })
  })

  it('bans a signed-in user by user id only, not by IP', () => {
    const { room, persisted, h } = loaded()
    joinAs(room, user('u2'))
    room.handle(h.conn.id, { type: 'mod', op: 'ban', target: 'u2' })
    expect(persisted.bans).toEqual(['user:u2'])
    expect(joinAs(room, guest('g5'), 'c-u2').result.ok).toBe(true)
  })

  it('applies bans loaded at construction', () => {
    const { room } = makeRoom({ bans: ['user:u2'] })
    expect(joinAs(room, user('u2')).result).toEqual({ ok: false, code: 'banned' })
  })

  it('mute blocks chat and unmute restores it', () => {
    const { room, h, g } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'mute', target: 'g1' })
    room.handle(g.conn.id, { type: 'chat', text: 'hello' })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'mod', op: 'unmute', target: 'g1' })
    room.handle(g.conn.id, { type: 'chat', text: 'hello' })
    expect(h.conn.last('chat')?.message.text).toBe('hello')
  })

  it('lets moderators delete a chat message and tells everyone', () => {
    const { room, h, g } = loaded()
    room.handle(g.conn.id, { type: 'chat', text: 'rude' })
    const id = h.conn.last('chat')!.message.id
    room.handle(g.conn.id, { type: 'mod', op: 'deleteMessage', target: id })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'mod', op: 'deleteMessage', target: id })
    expect(g.conn.last('chatRemoved')?.id).toBe(id)
  })

  it('does not allow promoting guests', () => {
    const { room, h } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'promote', target: 'g1' })
    expect(h.conn.last('error')?.code).toBe('forbidden')
  })

  it('returns not_found for a target who is not in the room', () => {
    const { room, h } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'kick', target: 'ghost' })
    expect(h.conn.last('error')?.code).toBe('not_found')
  })
})

describe('settings, heartbeat, lifecycle', () => {
  it('lets only the host change settings, persists them, and clamps maxViewers to 30', () => {
    const { room, persisted, h, g } = loaded()
    room.handle(g.conn.id, { type: 'settings', patch: { chatEnabled: false } })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'settings', patch: { maxViewers: 99, controlMode: 'everyone' } })
    expect(g.conn.last('settings')?.settings).toMatchObject({ maxViewers: 30, controlMode: 'everyone' })
    expect(persisted.settings.at(-1)).toMatchObject({ maxViewers: 30, controlMode: 'everyone' })
  })

  it('broadcasts a heartbeat every 5s and not before', () => {
    const { room, advance, g } = loaded()
    advance(4_999); room.tick()
    expect(g.conn.all('heartbeat')).toHaveLength(0)
    advance(1); room.tick()
    expect(g.conn.all('heartbeat')).toHaveLength(1)
  })

  it('tracks emptiness and closes everyone on destroy', () => {
    const { room, advance, now, h, g } = loaded()
    expect(room.emptySince).toBeNull()
    room.leave(h.conn.id); room.leave(g.conn.id)
    expect(room.emptySince).toBe(now())
    advance(1)
    const late = joinAs(room, host(), 'late')
    expect(room.emptySince).toBeNull()
    room.destroy()
    expect(late.conn.closed?.code).toBe(4005)
  })
})

describe('buffering abuse and feedback (I1, I2)', () => {
  it('ignores repeated buffering reports that change nothing: no broadcasts', () => {
    const { room, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    expect(room.engine.state.isPlaying).toBe(false)
    let before = h.conn.sent.length
    for (let i = 0; i < 5; i++) room.handle(g.conn.id, { type: 'buffering', value: true })
    expect(h.conn.sent.length).toBe(before)
    room.handle(g.conn.id, { type: 'buffering', value: false })
    expect(room.engine.state.isPlaying).toBe(true)
    before = h.conn.sent.length
    for (let i = 0; i < 5; i++) room.handle(g.conn.id, { type: 'buffering', value: false })
    expect(h.conn.sent.length).toBe(before)
  })

  it('counts rapid buffering toggles as strikes and eventually disconnects', () => {
    const { room, h, g } = loaded({ settings: { pauseOnBuffering: false } })
    const before = h.conn.all('members').length
    for (let i = 0; i < 40 && !g.conn.closed; i++) room.handle(g.conn.id, { type: 'buffering', value: i % 2 === 0 })
    expect(g.conn.all('error').some((e) => e.code === 'rate_limited')).toBe(true)
    expect(g.conn.closed?.code).toBe(4008)
    // only the allowed toggles, the auto-mute and the eviction reach everyone else
    expect(h.conn.all('members').length - before).toBeLessThanOrEqual(8)
  })

  it('ignores buffering:true for 1.5s after the server itself resumed playback', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true }) // server auto-pauses
    room.handle(g.conn.id, { type: 'buffering', value: false }) // server resumes
    const states = h.conn.all('state').length
    advance(1_000)
    room.handle(g.conn.id, { type: 'buffering', value: true }) // the brief stall that resuming causes
    expect(room.engine.state.isPlaying).toBe(true)
    expect(h.conn.all('state').length).toBe(states)
    room.handle(g.conn.id, { type: 'buffering', value: false })
    advance(500)
    room.handle(g.conn.id, { type: 'buffering', value: true }) // a real stall later still pauses
    expect(room.engine.state.isPlaying).toBe(false)
  })

  it('ignores buffering:true right after the buffering timeout resumed the room', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    advance(10_000); room.tick()
    expect(room.engine.state.isPlaying).toBe(true)
    room.handle(g.conn.id, { type: 'buffering', value: true })
    expect(room.engine.state.isPlaying).toBe(true)
  })

  it('a user play is not a server-caused change: buffering right after it still pauses', () => {
    const { room, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    expect(room.engine.state.isPlaying).toBe(false)
  })
})

describe('room password abuse (I3)', () => {
  it('limits failed password attempts per IP and stops running the hash check', () => {
    const ctx = makeRoom({ password: 'pw' })
    for (let i = 0; i < 5; i++) {
      expect(joinAs(ctx.room, guest(`g${i}`), `c${i}`, 'nope', 'ip-x').result).toEqual({ ok: false, code: 'bad_password' })
    }
    const calls = ctx.verifyCalls()
    expect(joinAs(ctx.room, guest('g9'), 'c9', 'pw', 'ip-x').result).toEqual({ ok: false, code: 'rate_limited' })
    expect(ctx.verifyCalls()).toBe(calls) // no scrypt while limited
    expect(joinAs(ctx.room, guest('g8'), 'c8', 'pw', 'ip-y').result.ok).toBe(true) // other IPs unaffected
    ctx.advance(60_000)
    expect(joinAs(ctx.room, guest('g9'), 'c9b', 'pw', 'ip-x').result.ok).toBe(true)
  })

  it('skips the hash check for an identity that already verified in this room', () => {
    const ctx = makeRoom({ password: 'pw' })
    expect(joinAs(ctx.room, guest('g1'), 'c1', 'pw').result.ok).toBe(true)
    ctx.room.leave('c1')
    const calls = ctx.verifyCalls()
    expect(joinAs(ctx.room, guest('g1'), 'c2').result.ok).toBe(true)
    expect(ctx.verifyCalls()).toBe(calls)
    expect(joinAs(ctx.room, guest('g2'), 'c3').result).toEqual({ ok: false, code: 'bad_password' })
  })

  it('a banned identity gets no shortcut, and destroy forgets verified identities', () => {
    const ctx = makeRoom({ password: 'pw' })
    joinAs(ctx.room, host())
    joinAs(ctx.room, guest('g1'), 'c1', 'pw', 'ip-1')
    ctx.room.handle('c-host-1', { type: 'mod', op: 'ban', target: 'g1' })
    expect(joinAs(ctx.room, guest('g1'), 'c2', undefined, 'ip-2').result).toEqual({ ok: false, code: 'banned' })
    joinAs(ctx.room, user('u2'), 'c3', 'pw')
    ctx.room.destroy()
    expect(joinAs(ctx.room, user('u2'), 'c4').result).toEqual({ ok: false, code: 'bad_password' })
  })
})

describe('launch metrics (I10b)', () => {
  it('counts joins, replacements, kicks, bans and rate-limit hits', () => {
    const ctx = makeRoom()
    joinAs(ctx.room, host())
    joinAs(ctx.room, guest('g1'), 'c1')
    joinAs(ctx.room, guest('g1'), 'c1b') // second tab replaces the first
    joinAs(ctx.room, guest('g2'), 'c2')
    ctx.room.handle('c-host-1', { type: 'mod', op: 'kick', target: 'g1' })
    ctx.room.handle('c-host-1', { type: 'mod', op: 'ban', target: 'g2' })
    for (let i = 0; i < 11; i++) ctx.room.handle('c-host-1', { type: 'control', version: 0, action: 'setSource', source } as never)
    expect(ctx.metrics.snapshot()).toEqual({ joins: 4, reconnectsReplaced: 1, kicks: 1, bans: 1, rateLimited: 1, reports: 0 })
  })
})
