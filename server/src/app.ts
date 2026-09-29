import cors from '@fastify/cors'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { sanitizeNickname, sanitizeText, type PublicSettings, type RoomSettings } from '@unison/shared'
import type { Auth, AuthIdentity } from './auth'
import { clientIp } from './clientIp'
import { hashPassword } from './password'
import { hashIp } from './privacy'
import { RateLimiter } from './rateLimiter'
import type { RoomManager } from './roomManager'
import { newSlug } from './slug'
import { SlugTakenError, type RoomRecord, type Stores } from './stores'

export interface AppDeps {
  auth: Auth
  stores: Stores
  manager: RoomManager
  ipSecret: string
  clientOrigin: string | string[]
  now: () => number
  nextId: () => string
  trustProxy?: boolean
  makeSlug?: () => string
}

export const DEFAULT_SETTINGS: RoomSettings = {
  controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true,
}
const DAY_MS = 86_400_000
const MAX_OPEN_ROOMS = 3
const MAX_ROOMS_PER_DAY = 20

const createBody = z.object({
  name: z.string().min(1).max(60),
  password: z.string().min(1).max(64).optional(),
  settings: z
    .object({
      controlMode: z.enum(['host', 'everyone']),
      allowGuests: z.boolean(),
      maxViewers: z.number().int().min(1).max(30),
      chatEnabled: z.boolean(),
      pauseOnBuffering: z.boolean(),
    })
    .partial()
    .optional(),
})
const reportBody = z.object({ reason: z.string().min(1).max(500) })

export async function createApp(d: AppDeps) {
  // Not Fastify's trustProxy: that makes req.ip the client-controlled left-most X-Forwarded-For entry.
  // clientIp() is shared with the WebSocket gateway so REST and WS limits key on the same address.
  const app = Fastify()
  await app.register(cors, {
    origin: d.clientOrigin,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
  })

  const guestLimiter = new RateLimiter(20, 60_000, d.now)
  const reportLimiter = new RateLimiter(5, 60_000, d.now)
  const roomInfoLimiter = new RateLimiter(60, 60_000, d.now)
  const pruner = setInterval(() => {
    for (const l of [guestLimiter, reportLimiter, roomInfoLimiter]) l.prune()
  }, 60_000)
  pruner.unref()
  app.addHook('onClose', async () => clearInterval(pruner))
  const ipKey = (req: FastifyRequest) => hashIp(clientIp(req.raw, d.trustProxy ?? false), d.ipSecret, d.now())
  const makeSlug = d.makeSlug ?? newSlug
  const pub = (r: RoomRecord): PublicSettings => ({ ...r.settings, hasPassword: r.passwordHash !== null })
  const live = (slug: string) => d.manager.peek(slug)?.size ?? 0

  async function identify(req: FastifyRequest): Promise<AuthIdentity | null> {
    const h = req.headers.authorization
    return h?.startsWith('Bearer ') ? d.auth.verify(h.slice(7)) : null
  }
  async function requireHost(req: FastifyRequest, reply: FastifyReply): Promise<AuthIdentity | null> {
    const me = await identify(req)
    if (!me || me.isGuest) {
      void reply.code(401).send({ error: 'unauthorized' })
      return null
    }
    return me
  }

  app.get('/health', async () => ({ ok: true }))
  app.get('/stats', async () => d.manager.stats())

  app.post('/guest', async (req, reply) => {
    if (!guestLimiter.allow(ipKey(req))) return reply.code(429).send({ error: 'rate_limited' })
    const nickname = sanitizeNickname((req.body as { nickname?: unknown } | null)?.nickname)
    if (!nickname) return reply.code(400).send({ error: 'bad_nickname' })
    const id = d.nextId()
    return { token: await d.auth.issueGuest(nickname, id), id, nickname }
  })

  app.get('/rooms/:slug', async (req, reply) => {
    if (!roomInfoLimiter.allow(ipKey(req))) return reply.code(429).send({ error: 'rate_limited' })
    const { slug } = req.params as { slug: string }
    const rec = await d.stores.rooms.getBySlug(slug)
    if (!rec || rec.closedAt !== null) return reply.code(404).send({ error: 'not_found' })
    return { slug: rec.slug, name: rec.name, ownerName: rec.ownerName, live: live(rec.slug), settings: pub(rec) }
  })

  app.post('/rooms', async (req, reply) => {
    const me = await requireHost(req, reply)
    if (!me) return
    const parsed = createBody.safeParse(req.body)
    const name = parsed.success ? sanitizeText(parsed.data.name, 60) : ''
    if (!parsed.success || !name) return reply.code(400).send({ error: 'bad_request' })
    if ((await d.stores.rooms.listOpenByOwner(me.id)).length >= MAX_OPEN_ROOMS) {
      return reply.code(429).send({ error: 'too_many_rooms' })
    }
    if ((await d.stores.rooms.countCreatedSince(me.id, d.now() - DAY_MS)) >= MAX_ROOMS_PER_DAY) {
      return reply.code(429).send({ error: 'daily_limit' })
    }
    const base = {
      id: d.nextId(), ownerId: me.id, ownerName: me.nickname, name,
      settings: { ...DEFAULT_SETTINGS, ...parsed.data.settings },
      passwordHash: parsed.data.password ? hashPassword(parsed.data.password) : null,
      createdAt: d.now(), closedAt: null,
    }
    for (let i = 0; i < 5; i++) {
      const slug = makeSlug()
      if (await d.stores.rooms.getBySlug(slug)) continue
      const rec: RoomRecord = { ...base, slug }
      try {
        await d.stores.rooms.create(rec)
      } catch (e) {
        if (e instanceof SlugTakenError) continue // lost an insert race for this slug: draw another
        throw e
      }
      return reply.code(201).send({ id: rec.id, slug: rec.slug })
    }
    return reply.code(500).send({ error: 'slug_unavailable' })
  })

  app.get('/rooms', async (req, reply) => {
    const me = await requireHost(req, reply)
    if (!me) return
    const rooms = await d.stores.rooms.listOpenByOwner(me.id)
    return rooms.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, live: live(r.slug), settings: pub(r), createdAt: r.createdAt,
    }))
  })

  app.delete('/rooms/:id', async (req, reply) => {
    const me = await requireHost(req, reply)
    if (!me) return
    const rec = await d.stores.rooms.getById((req.params as { id: string }).id)
    if (!rec || rec.ownerId !== me.id) return reply.code(404).send({ error: 'not_found' })
    await d.stores.rooms.close(rec.id, d.now())
    d.manager.closeRoom(rec.id)
    return reply.code(204).send()
  })

  app.post('/rooms/:slug/report', async (req, reply) => {
    if (!reportLimiter.allow(ipKey(req))) return reply.code(429).send({ error: 'rate_limited' })
    const parsed = reportBody.safeParse(req.body)
    const reason = parsed.success ? sanitizeText(parsed.data.reason, 500) : ''
    if (!reason) return reply.code(400).send({ error: 'bad_request' })
    const rec = await d.stores.rooms.getBySlug((req.params as { slug: string }).slug)
    if (!rec) return reply.code(404).send({ error: 'not_found' })
    const me = await identify(req)
    await d.stores.reports.add({ roomId: rec.id, reporterId: me && !me.isGuest ? me.id : null, reason, at: d.now() })
    return reply.code(202).send({ ok: true })
  })

  return app
}
