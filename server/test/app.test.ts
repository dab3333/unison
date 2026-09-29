import { describe, it, expect, beforeEach } from 'vitest'
import { SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app'
import { createAuth } from '../src/auth'
import { createMemoryStores } from '../src/memoryStores'
import { RoomManager } from '../src/roomManager'
import type { Stores } from '../src/stores'
import { record, OWNER } from './storeContract'

const SB = 'sb-secret-1234567890'
const auth = createAuth({ guestSecret: 'guest-secret-1234567890', supabaseJwtSecret: SB })
const signUser = (id: string, name = 'Maya') =>
  new SignJWT({ user_metadata: { full_name: name } }).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
    .setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(SB))

let app: FastifyInstance
let stores: Stores
let manager: RoomManager
let n = 0

beforeEach(async () => {
  stores = createMemoryStores()
  n = 0
  manager = new RoomManager({ stores, now: Date.now, nextId: () => `id-${++n}`, maxRooms: 100, idleMs: 600_000 })
  app = await createApp({
    auth, stores, manager, ipSecret: 'ip-secret-1234567890123456', clientOrigin: 'http://localhost:5173',
    now: Date.now, nextId: () => `id-${++n}`,
  })
})

const bearer = async (id = OWNER) => ({ authorization: `Bearer ${await signUser(id)}` })
const create = async (body: unknown = { name: 'Movie night' }, id = OWNER) =>
  app.inject({ method: 'POST', url: '/rooms', headers: await bearer(id), payload: body as object })

describe('health and stats', () => {
  it('reports health and live stats', async () => {
    expect((await app.inject('/health')).json()).toEqual({ ok: true })
    expect((await app.inject('/stats')).json()).toEqual({ rooms: 0, sockets: 0 })
  })
})

describe('POST /guest', () => {
  it('issues a verifiable guest token with a sanitized nickname', async () => {
    const res = await app.inject({ method: 'POST', url: '/guest', payload: { nickname: '  Pat\u0000  ' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.nickname).toBe('Pat')
    expect(await auth.verify(body.token)).toEqual({ id: body.id, nickname: 'Pat', isGuest: true })
  })
  it('rejects empty nicknames', async () => {
    const res = await app.inject({ method: 'POST', url: '/guest', payload: { nickname: '   ' } })
    expect(res.statusCode).toBe(400)
  })
  it('rate limits per IP at 20 per minute', async () => {
    let last = 0
    for (let i = 0; i < 21; i++) {
      last = (await app.inject({ method: 'POST', url: '/guest', payload: { nickname: 'x' }, remoteAddress: '198.51.100.7' })).statusCode
    }
    expect(last).toBe(429)
  })
})

describe('POST /rooms', () => {
  it('requires a signed-in (non-guest) user', async () => {
    expect((await app.inject({ method: 'POST', url: '/rooms', payload: { name: 'x' } })).statusCode).toBe(401)
    const g = await (await app.inject({ method: 'POST', url: '/guest', payload: { nickname: 'Pat' } })).json()
    const res = await app.inject({ method: 'POST', url: '/rooms', headers: { authorization: `Bearer ${g.token}` }, payload: { name: 'x' } })
    expect(res.statusCode).toBe(401)
  })
  it('creates a room with defaults and hashes the password', async () => {
    const res = await create({ name: 'Movie night', password: 'secret' })
    expect(res.statusCode).toBe(201)
    const { id, slug } = res.json()
    const rec = await stores.rooms.getById(id)
    expect(rec).toMatchObject({ slug, ownerId: OWNER, ownerName: 'Maya', name: 'Movie night' })
    expect(rec?.settings).toMatchObject({ controlMode: 'host', allowGuests: true, maxViewers: 15 })
    expect(rec?.passwordHash).not.toBeNull()
    expect(rec?.passwordHash).not.toContain('secret')
  })
  it('validates the body', async () => {
    expect((await create({ name: '' })).statusCode).toBe(400)
    expect((await create({ name: 'x', settings: { maxViewers: 31 } })).statusCode).toBe(400)
    expect((await create({ name: 'x', password: '' })).statusCode).toBe(400)
  })
  it('limits open rooms per host to 3 and frees a slot when one is closed', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await create()).json().id)
    const blocked = await create()
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ error: 'too_many_rooms' })
    await app.inject({ method: 'DELETE', url: `/rooms/${ids[0]}`, headers: await bearer() })
    expect((await create()).statusCode).toBe(201)
  })
  it('limits creation to 20 per day', async () => {
    for (let i = 0; i < 20; i++) await stores.rooms.create(record({ closedAt: 1 }))
    const res = await create()
    expect(res.statusCode).toBe(429)
    expect(res.json()).toEqual({ error: 'daily_limit' })
  })
})

describe('room info, listing, closing', () => {
  it('serves public info without the password hash, 404 when unknown or closed', async () => {
    const { slug, id } = (await create({ name: 'Movie night', password: 'pw' })).json()
    const info = (await app.inject(`/rooms/${slug}`)).json()
    expect(info).toMatchObject({ slug, name: 'Movie night', ownerName: 'Maya', live: 0, settings: { hasPassword: true } })
    expect(JSON.stringify(info)).not.toContain('passwordHash')
    expect((await app.inject('/rooms/nope')).statusCode).toBe(404)
    await app.inject({ method: 'DELETE', url: `/rooms/${id}`, headers: await bearer() })
    expect((await app.inject(`/rooms/${slug}`)).statusCode).toBe(404)
  })
  it('lists only the caller’s open rooms', async () => {
    await create({ name: 'mine' })
    await create({ name: 'theirs' }, '00000000-0000-4000-8000-000000000002')
    const list = (await app.inject({ method: 'GET', url: '/rooms', headers: await bearer() })).json()
    expect(list.map((r: { name: string }) => r.name)).toEqual(['mine'])
  })
  it('only lets the owner close a room; others get 404', async () => {
    const { id } = (await create()).json()
    const other = await app.inject({ method: 'DELETE', url: `/rooms/${id}`, headers: await bearer('00000000-0000-4000-8000-000000000002') })
    expect(other.statusCode).toBe(404)
    const own = await app.inject({ method: 'DELETE', url: `/rooms/${id}`, headers: await bearer() })
    expect(own.statusCode).toBe(204)
    expect((await stores.rooms.getById(id))?.closedAt).not.toBeNull()
  })
})

describe('POST /rooms/:slug/report', () => {
  it('accepts a report, validates it, and rate limits', async () => {
    const { slug } = (await create()).json()
    const url = `/rooms/${slug}/report`
    expect((await app.inject({ method: 'POST', url, payload: { reason: '' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/rooms/nope/report', payload: { reason: 'spam' } })).statusCode).toBe(404)
    let last = 0
    for (let i = 0; i < 6; i++) last = (await app.inject({ method: 'POST', url, payload: { reason: 'spam' }, remoteAddress: '198.51.100.9' })).statusCode
    expect(last).toBe(429)
    expect((await app.inject({ method: 'POST', url, payload: { reason: 'spam' }, remoteAddress: '198.51.100.10' })).statusCode).toBe(202)
  })
})
