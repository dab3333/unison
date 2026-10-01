import { randomUUID } from 'node:crypto'
import { createApp } from './app'
import type { Auth } from './auth'
import { attachGateway } from './gateway'
import { Metrics } from './metrics'
import { RoomManager } from './roomManager'
import type { Stores } from './stores'

export interface ServerOptions {
  auth: Auth
  stores: Stores
  clientOrigin: string | string[]
  ipSecret: string
  trustProxy: boolean
  maxRooms: number
  maxSockets: number
  maxPerIp: number
  helloTimeoutMs?: number
  now?: () => number
  nextId?: () => string
}

export async function buildServer(o: ServerOptions) {
  const now = o.now ?? Date.now
  const nextId = o.nextId ?? (() => randomUUID())
  const metrics = new Metrics()
  const manager = new RoomManager({ stores: o.stores, now, nextId, maxRooms: o.maxRooms, idleMs: 600_000, metrics })
  const app = await createApp({
    auth: o.auth, stores: o.stores, manager, ipSecret: o.ipSecret, clientOrigin: o.clientOrigin, now, nextId,
    trustProxy: o.trustProxy, metrics,
  })
  const gateway = attachGateway(app.server, {
    auth: o.auth, manager, ipSecret: o.ipSecret, now, nextId, maxSockets: o.maxSockets, maxPerIp: o.maxPerIp,
    trustProxy: o.trustProxy, helloTimeoutMs: o.helloTimeoutMs, metrics,
  })
  const ticker = setInterval(() => manager.tickAll(), 1000)
  app.addHook('onClose', async () => {
    clearInterval(ticker)
    gateway.close()
  })
  return { app, manager }
}
