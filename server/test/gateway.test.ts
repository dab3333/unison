import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { SignJWT } from 'jose'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { createAuth } from '../src/auth'
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
})
