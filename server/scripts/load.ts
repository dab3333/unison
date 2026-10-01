// ~300 sockets over 20 rooms against an in-memory server. Run: npx tsx server/scripts/load.ts
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { createAuth } from '../src/auth'
import { createMemoryStores } from '../src/memoryStores'
import { buildServer } from '../src/server'

const ROOMS = 20
const PER_ROOM = 15
const auth = createAuth({ guestSecret: 'load-guest-secret-0123456789abcdef', supabaseJwtSecret: 'load-jwt-secret-0123456789abcdef' })
const stores = createMemoryStores()
const { app, manager } = await buildServer({
  auth, stores, clientOrigin: '*', ipSecret: 'load-ip-secret-0123456789abcdef', trustProxy: false,
  maxRooms: 100, maxSockets: 1000, maxPerIp: 10_000,
})
await app.listen({ port: 0, host: '127.0.0.1' })
const port = (app.server.address() as AddressInfo).port

for (let r = 0; r < ROOMS; r++) {
  await stores.rooms.create({
    id: randomUUID(), slug: `load-${r}`, ownerId: randomUUID(), ownerName: 'Load', name: `Load ${r}`,
    settings: { controlMode: 'everyone', allowGuests: true, maxViewers: PER_ROOM, chatEnabled: true, pauseOnBuffering: true },
    passwordHash: null, createdAt: Date.now(), closedAt: null,
  })
}

interface Client { ws: WebSocket; room: number; playedAt?: number }
const now = () => performance.now()

function connect(room: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=load-${room}`)
    const c: Client = { ws, room }
    const timer = setTimeout(() => reject(new Error(`join timeout in room ${room}`)), 15_000)
    ws.on('open', async () => ws.send(JSON.stringify({ type: 'hello', token: await auth.issueGuest('g', randomUUID()) })))
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (m.type === 'welcome') { clearTimeout(timer); resolve(c) }
      if (m.type === 'state' && m.state.isPlaying && c.playedAt === undefined) c.playedAt = now()
    })
    ws.on('error', reject)
  })
}
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0

const joinStart = now()
// Connect in waves: a single 300-socket burst overflows the listen backlog on Windows (ECONNREFUSED).
const clients: Client[] = []
for (let n = 0; n < ROOMS * PER_ROOM; n += 30) {
  clients.push(...(await Promise.all(Array.from({ length: 30 }, (_, i) => connect(Math.floor((n + i) / PER_ROOM))))))
}
const joinMs = now() - joinStart

const sentAt: number[] = []
for (let r = 0; r < ROOMS; r++) {
  const controller = clients.find((c) => c.room === r)!
  sentAt[r] = now()
  controller.ws.send(JSON.stringify({ type: 'control', version: 0, action: 'setSource', source: { type: 'file', name: 'a.mp4', size: 1, duration: 600 } }))
  controller.ws.send(JSON.stringify({ type: 'control', version: 1, action: 'play', position: 0 }))
}
await new Promise((r) => setTimeout(r, 3000))

const latencies = clients.filter((c) => c.playedAt !== undefined).map((c) => c.playedAt! - sentAt[c.room]!)
const stats = manager.stats()
console.log({ sockets: clients.length, joinMsTotal: Math.round(joinMs), fanOutReceived: latencies.length, fanOutP95Ms: Math.round(p95(latencies)), stats, rssMB: Math.round(process.memoryUsage().rss / 1e6) })

clients.forEach((c) => c.ws.close())
await app.close()
const ok = clients.length === ROOMS * PER_ROOM && latencies.length === clients.length && stats.sockets === clients.length
console.log(ok ? 'LOAD CHECK PASSED' : 'LOAD CHECK FAILED')
process.exit(ok ? 0 : 1)
