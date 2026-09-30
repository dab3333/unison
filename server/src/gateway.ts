import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { clientMessageSchema, type ErrorCode, type ServerMessage } from '@unison/shared'
import type { Auth } from './auth'
import { clientIp } from './clientIp'
import type { Metrics } from './metrics'
import { hashIp } from './privacy'
import { TokenBucket } from './rateLimiter'
import type { Conn, Room } from './room'
import type { RoomManager } from './roomManager'

export interface GatewayDeps {
  auth: Auth
  manager: RoomManager
  ipSecret: string
  now: () => number
  nextId: () => string
  maxSockets: number
  maxPerIp: number
  trustProxy: boolean
  helloTimeoutMs?: number
  metrics?: Metrics
}

const send = (ws: WebSocket, m: ServerMessage) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
}
const logFault = (e: unknown) => {
  const err = e instanceof Error ? e : new Error('non-error thrown')
  console.error(`gateway: handler fault (${err.name}: ${err.message})`)
}
/** Per-connection message budget: plenty for a real client (pings, chat, controls), not enough to flood the room. */
const MSG_PER_SEC = 20
const MSG_BURST = 40

const errorMsg = (code: ErrorCode, message: string = code): ServerMessage => ({ type: 'error', code, message })

export function attachGateway(server: Server, d: GatewayDeps): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 })
  const perIp = new Map<string, number>()
  let total = 0

  server.on('upgrade', (req, socket, head) => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return void socket.destroy()
    }
    if (url.pathname !== '/ws') return void socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url.searchParams.get('room') ?? ''))
  })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage, slug: string) => {
    ws.on('error', () => {})
    const ipHash = hashIp(clientIp(req, d.trustProxy), d.ipSecret, d.now())
    if (total >= d.maxSockets || (perIp.get(ipHash) ?? 0) >= d.maxPerIp) return void ws.close(1013, 'busy')
    total++
    perIp.set(ipHash, (perIp.get(ipHash) ?? 0) + 1)

    const conn: Conn = {
      id: d.nextId(),
      ipHash,
      send: (m) => send(ws, m),
      close: (code, reason) => ws.close(code, reason),
    }
    let room: Room | null = null
    let joining = false
    const bucket = new TokenBucket(MSG_PER_SEC, MSG_BURST, d.now)
    const helloTimer = setTimeout(() => {
      if (!room) ws.close(4000, 'hello timeout')
    }, d.helloTimeoutMs ?? 5000)

    ws.on('message', async (raw) => {
      if (ws.readyState !== ws.OPEN) return // already closing (e.g. over the limit): drop what is still queued
      if (!bucket.take()) {
        d.metrics?.inc('rateLimited')
        return void ws.close(4008, 'rate limit exceeded')
      }
      let json: unknown
      try {
        json = JSON.parse(raw.toString())
      } catch {
        return send(ws, errorMsg('bad_request', 'invalid json'))
      }
      const parsed = clientMessageSchema.safeParse(json)
      if (!parsed.success) return send(ws, errorMsg('bad_request', 'invalid message'))
      const msg = parsed.data

      if (room) {
        try {
          return room.handle(conn.id, msg)
        } catch (e) {
          logFault(e)
          return void ws.close(1011, 'server error')
        }
      }
      if (msg.type !== 'hello') return send(ws, errorMsg('unauthorized', 'send hello first'))
      if (joining) return
      joining = true
      try {
        const identity = await d.auth.verify(msg.token)
        if (!identity) {
          send(ws, errorMsg('unauthorized'))
          return void ws.close(4002, 'unauthorized')
        }
        const got = await d.manager.get(slug)
        if (!got.ok) {
          send(ws, errorMsg(got.code === 'busy' ? 'room_full' : 'not_found'))
          return void ws.close(4006, got.code)
        }
        const res = got.room.join(conn, identity, msg.password)
        if (!res.ok) {
          send(ws, errorMsg(res.code))
          return void ws.close(res.code === 'banned' ? 4004 : 4006, res.code)
        }
        if (ws.readyState !== ws.OPEN) return void got.room.leave(conn.id) // client left during the join
        room = got.room
      } catch (e) {
        logFault(e)
        ws.close(1011, 'server error')
      } finally {
        joining = false
      }
    })

    ws.on('close', () => {
      clearTimeout(helloTimer)
      room?.leave(conn.id)
      total--
      const left = (perIp.get(ipHash) ?? 1) - 1
      if (left <= 0) perIp.delete(ipHash)
      else perIp.set(ipHash, left)
    })
  })

  return {
    close: () => {
      for (const c of wss.clients) c.terminate()
      wss.close()
    },
  }
}
