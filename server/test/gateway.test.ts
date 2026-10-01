import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { SignJWT } from 'jose'
import net, { type AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { createAuth, type Auth } from '../src/auth'
import { createMemoryStores } from '../src/memoryStores'
import { buildServer } from '../src/server'
import type { Stores } from '../src/stores'
import { record, OWNER } from './storeContract'

const SB = 'sb-secret-1234567890'
const auth = createAuth({ guestSecret: 'guest-secret-1234567890', supabaseJwtSecret: SB })
const hostToken = () =>
  new SignJWT({ user_metadata: { full_name: 'Maya' } }).setProtectedHeader({ alg: 'HS256' }).setSubject(OWNER)
    .setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(SB))
const guestToken = (id: string, nick = 'Pat') => auth.issueGuest(nick, id)

type Msg = Record<string, any>
function connect(port: number, slug: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${slug}`)
  const inbox: Msg[] = []
  const waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = []
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    inbox.push(m)
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m) }
  })
  const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)))
  const opened = new Promise<void>((res) => ws.on('open', () => res()))
  return {
    ws, inbox, closed, opened,
    send: (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    waitFor: (pred: (m: Msg) => boolean, ms = 2000) =>
      new Promise<Msg>((res, rej) => {
        const hit = inbox.find(pred)
        if (hit) return res(hit)
        const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms)
        waiters.push({ pred, res: (m) => { clearTimeout(t); res(m) } })
      }),
  }
}
const ofType = (type: string) => (m: Msg) => m.type === type

let app: FastifyInstance
let stores: Stores
let port: number
async function start(over: Partial<Parameters<typeof buildServer>[0]> = {}) {
  stores = createMemoryStores()
  let n = 0
  const built = await buildServer({
    auth, stores, clientOrigin: '*', ipSecret: 'ip-secret-1234567890123456', trustProxy: false,
    maxRooms: 100, maxSockets: 500, maxPerIp: 50, nextId: () => `id-${++n}`, ...over,
  })
  app = built.app
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
  const rec = record(); await stores.rooms.create(rec)
  return rec
}
afterEach(async () => { await app?.close() })

const media = { type: 'file', name: 'a.mp4', size: 1, duration: 600 }

describe('gateway', () => {
  it('runs a full host + guest session: sync state and chat', async () => {
    const rec = await start()
    const h = connect(port, rec.slug); await h.opened
    h.send({ type: 'hello', token: await hostToken() })
    expect((await h.waitFor(ofType('welcome'))).role).toBe('host')
    const g = connect(port, rec.slug); await g.opened
    g.send({ type: 'hello', token: await guestToken('g1') })
    expect((await g.waitFor(ofType('welcome'))).role).toBe('guest')

    h.send({ type: 'control', version: 0, action: 'setSource', source: media })
    h.send({ type: 'control', version: 1, action: 'play', position: 0 })
    const state = await g.waitFor((m) => m.type === 'state' && m.state.isPlaying)
    expect(state.state.source).toMatchObject({ type: 'file', name: 'a.mp4' })

    g.send({ type: 'chat', text: 'hello host' })
    expect((await h.waitFor(ofType('chat'))).message.text).toBe('hello host')
    h.ws.close(); g.ws.close()
  })

  it('survives junk input and keeps other clients unaffected (review focus 1)', async () => {
    const rec = await start()
    const good = connect(port, rec.slug); await good.opened
    good.send({ type: 'hello', token: await hostToken() })
    await good.waitFor(ofType('welcome'))

    const bad = connect(port, rec.slug); await bad.opened
    bad.send('{not json')
    expect((await bad.waitFor(ofType('error'))).code).toBe('bad_request')
    bad.send({ type: 'eval', code: 'process.exit(1)' })
    await bad.waitFor((m) => m.type === 'error' && bad.inbox.filter(ofType('error')).length === 2)
    bad.send({ type: 'chat', text: 'before hello' })
    await bad.waitFor((m) => m.code === 'unauthorized')
    bad.send({ type: 'hello', token: await guestToken('g1') }) // still usable after junk
    expect((await bad.waitFor(ofType('welcome'))).role).toBe('guest')

    const big = connect(port, rec.slug); await big.opened
    big.send(JSON.stringify({ type: 'hello', token: 'x'.repeat(20_000) }))
    expect(await big.closed).toBe(1009)

    good.send({ type: 'control', version: 0, action: 'setSource', source: media })
    await good.waitFor(ofType('state')) // server still healthy
    good.ws.close(); bad.ws.close()
  })

  it('closes with 4002 on a bad token and 4006 for an unknown room', async () => {
    const rec = await start()
    const a = connect(port, rec.slug); await a.opened
    a.send({ type: 'hello', token: 'garbage' })
    expect(await a.closed).toBe(4002)
    const b = connect(port, 'no-such-room'); await b.opened
    b.send({ type: 'hello', token: await guestToken('g1') })
    expect((await b.waitFor(ofType('error'))).code).toBe('not_found')
    expect(await b.closed).toBe(4006)
  })

  it('closes with 4000 when no hello arrives in time', async () => {
    const rec = await start({ helloTimeoutMs: 100 })
    const a = connect(port, rec.slug)
    expect(await a.closed).toBe(4000)
  })

  it('caps connections per IP with 1013', async () => {
    const rec = await start({ maxPerIp: 2 })
    const a = connect(port, rec.slug); const b = connect(port, rec.slug)
    await a.opened; await b.opened
    const c = connect(port, rec.slug)
    expect(await c.closed).toBe(1013)
    a.ws.close(); b.ws.close()
  })

  it('bans over the wire: banned guest is closed with 4004 and cannot come back', async () => {
    const rec = await start()
    const h = connect(port, rec.slug); await h.opened
    h.send({ type: 'hello', token: await hostToken() })
    await h.waitFor(ofType('welcome'))
    const token = await guestToken('g1')
    const g = connect(port, rec.slug); await g.opened
    g.send({ type: 'hello', token })
    await g.waitFor(ofType('welcome'))
    h.send({ type: 'mod', op: 'ban', target: 'g1' })
    expect(await g.closed).toBe(4004)
    const again = connect(port, rec.slug); await again.opened
    again.send({ type: 'hello', token })
    expect((await again.waitFor(ofType('error'))).code).toBe('banned')
    expect(await again.closed).toBe(4004)
    h.ws.close()
  })

  it('closes with 1011 when auth.verify throws, and keeps serving others', async () => {
    const throwing: Auth = { ...auth, verify: (t: string) => (t === 'boom' ? Promise.reject(new Error('x')) : auth.verify(t)) }
    const rec = await start({ auth: throwing })
    const a = connect(port, rec.slug); await a.opened
    a.send({ type: 'hello', token: 'boom' })
    expect(await a.closed).toBe(1011)
    const b = connect(port, rec.slug); await b.opened
    b.send({ type: 'hello', token: await guestToken('g1') })
    expect((await b.waitFor(ofType('welcome'))).role).toBe('guest')
    b.ws.close()
  })

  it('closes with 1011 when the store throws in manager.get, and keeps serving others', async () => {
    const base = createMemoryStores()
    const flaky: Stores = {
      ...base,
      rooms: { ...base.rooms, getBySlug: (slug: string) => (slug === 'flaky' ? Promise.reject(new Error('db down')) : base.rooms.getBySlug(slug)) },
    }
    const rec = await start({ stores: flaky })
    await flaky.rooms.create(rec)
    const a = connect(port, 'flaky'); await a.opened
    a.send({ type: 'hello', token: await guestToken('g1') })
    expect(await a.closed).toBe(1011)
    const b = connect(port, rec.slug); await b.opened
    b.send({ type: 'hello', token: await guestToken('g2') })
    expect((await b.waitFor(ofType('welcome'))).role).toBe('guest')
    b.ws.close()
  })

  it('survives malformed upgrade request targets', async () => {
    const rec = await start()
    for (const target of ['//', '///', '//[', 'http://[']) {
      await new Promise<void>((res) => {
        const c = net.connect(port, '127.0.0.1', () =>
          c.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`))
        c.on('close', () => res()); c.on('error', () => res())
      })
    }
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    expect(health.status).toBe(200)
    const a = connect(port, rec.slug); await a.opened
    a.send({ type: 'hello', token: await guestToken('g1') })
    expect((await a.waitFor(ofType('welcome'))).role).toBe('guest')
    a.ws.close()
  })

  it('releases the per-IP slot when clients disconnect', async () => {
    const rec = await start({ maxPerIp: 2 })
    const a = connect(port, rec.slug); const b = connect(port, rec.slug)
    await a.opened; await b.opened
    a.ws.close(); b.ws.close()
    await a.closed; await b.closed
    const c = connect(port, rec.slug); await c.opened
    c.send({ type: 'hello', token: await guestToken('g1') })
    expect((await c.waitFor(ofType('welcome'))).role).toBe('guest')
    c.ws.close()
  })

  it('closes a flooding connection with 4008 and keeps other clients unaffected', async () => {
    const rec = await start()
    const good = connect(port, rec.slug); await good.opened
    good.send({ type: 'hello', token: await hostToken() })
    await good.waitFor(ofType('welcome'))
    const bad = connect(port, rec.slug); await bad.opened
    bad.send({ type: 'hello', token: await guestToken('g1') })
    await bad.waitFor(ofType('welcome'))
    for (let i = 0; i < 300; i++) bad.send({ type: 'ping', t0: i })
    expect(await bad.closed).toBe(4008)
    good.send({ type: 'ping', t0: 42 })
    expect((await good.waitFor((m) => m.type === 'pong' && m.t0 === 42)).t0).toBe(42)
    expect(((await (await fetch(`http://127.0.0.1:${port}/stats`)).json()) as Msg).rateLimited).toBeGreaterThanOrEqual(1)
    good.ws.close()
  })
})

describe('gateway integration: moderation, limits, buffering, reconnect (spec section 8)', () => {
  async function joined(slug: string, token: string) {
    const c = connect(port, slug); await c.opened
    c.send({ type: 'hello', token })
    const welcome = await c.waitFor(ofType('welcome'))
    return { ...c, welcome }
  }

  it('kick closes the target with 4003 and tells the others', async () => {
    const rec = await start()
    const h = await joined(rec.slug, await hostToken())
    const g = await joined(rec.slug, await guestToken('g1'))
    h.send({ type: 'mod', op: 'kick', target: 'g1' })
    expect(await g.closed).toBe(4003)
    await h.waitFor((m) => m.type === 'members' && m.members.length === 1)
    h.ws.close()
  })

  it('refuses a viewer over the cap with room_full and 4006, but never the host', async () => {
    const rec = await start()
    await stores.rooms.saveSettings(rec.id, { ...rec.settings, maxViewers: 1 })
    const g1 = await joined(rec.slug, await guestToken('g1'))
    const g2 = connect(port, rec.slug); await g2.opened
    g2.send({ type: 'hello', token: await guestToken('g2') })
    expect((await g2.waitFor(ofType('error'))).code).toBe('room_full')
    expect(await g2.closed).toBe(4006)
    const h = await joined(rec.slug, await hostToken())
    expect(h.welcome.role).toBe('host')
    g1.ws.close(); h.ws.close()
  })

  it('refuses guests with forbidden and 4006 when guests are off, and lets signed-in users in', async () => {
    const rec = await start()
    await stores.rooms.saveSettings(rec.id, { ...rec.settings, allowGuests: false })
    const g = connect(port, rec.slug); await g.opened
    g.send({ type: 'hello', token: await guestToken('g1') })
    expect((await g.waitFor(ofType('error'))).code).toBe('forbidden')
    expect(await g.closed).toBe(4006)
    const h = await joined(rec.slug, await hostToken())
    h.ws.close()
  })

  it('pauses everyone while a member buffers and resumes when they are ready', async () => {
    const rec = await start()
    const h = await joined(rec.slug, await hostToken())
    const g = await joined(rec.slug, await guestToken('g1'))
    h.send({ type: 'control', version: 0, action: 'setSource', source: media })
    h.send({ type: 'control', version: 1, action: 'play', position: 0 })
    await g.waitFor((m) => m.type === 'state' && m.state.isPlaying)
    g.send({ type: 'buffering', value: true })
    const paused = await h.waitFor((m) => m.type === 'state' && !m.state.isPlaying && m.holdingUp)
    expect(paused.holdingUp).toEqual(['g1'])
    g.send({ type: 'buffering', value: false })
    await h.waitFor((m) => m.type === 'state' && m.state.isPlaying && m.state.version > paused.state.version)
    h.ws.close(); g.ws.close()
  })

  it('a reconnecting client gets a fresh welcome with the current version, and its stale version is refused', async () => {
    const rec = await start()
    const h1 = await joined(rec.slug, await hostToken())
    h1.send({ type: 'control', version: 0, action: 'setSource', source: media })
    h1.send({ type: 'control', version: 1, action: 'play', position: 0 })
    await h1.waitFor((m) => m.type === 'state' && m.state.version === 2)
    h1.ws.close(); await h1.closed
    const g = await joined(rec.slug, await guestToken('g1')) // keeps the room live meanwhile
    const h2 = await joined(rec.slug, await hostToken())
    expect(h2.welcome.state).toMatchObject({ version: 2, isPlaying: true })
    h2.send({ type: 'control', version: 0, action: 'pause', position: 1 }) // the version it saw before the drop
    expect((await h2.waitFor(ofType('error'))).code).toBe('stale')
    h2.send({ type: 'control', version: 2, action: 'pause', position: 1 })
    await g.waitFor((m) => m.type === 'state' && m.state.version === 3 && !m.state.isPlaying)
    h2.ws.close(); g.ws.close()
  })
})

