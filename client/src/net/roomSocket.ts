import type { ClientMessage, ServerMessage } from '@unison/shared'

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface WSLike {
  readyState: number
  send(d: string): void
  close(): void
  onopen: (() => void | Promise<void>) | null
  onmessage: ((e: { data: string }) => void) | null
  onclose: ((e: { code: number }) => void) | null
}

export interface RoomSocketOpts {
  url: string
  getHello(): Promise<ClientMessage | null>
  onMessage(m: ServerMessage): void
  onStatus(s: SocketStatus, info?: { code: number }): void
  create?(url: string): WSLike
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(h: unknown): void
  random?(): number
}

/**
 * Replaced by another tab, kicked, banned, room closed, join refused, unauthorized, rate limit: reconnecting
 * would not help (for 4001 it would steal the room back from the other tab, forever). Only an explicit connect() retries.
 */
const FATAL = new Set([4001, 4002, 4003, 4004, 4005, 4006, 4008])

export class RoomSocket {
  private ws: WSLike | null = null
  private attempt = 0
  private timer: unknown = null
  private stopped = false

  constructor(private o: RoomSocketOpts) {}

  connect(): void {
    this.stopped = false
    this.attempt = 0 // a deliberate (re)connect starts fresh
    // Tear down any existing socket and pending timer before opening a new one
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.close()
    }
    if (this.timer !== null) {
      (this.o.clearTimer ?? ((h) => clearTimeout(h as number)))(this.timer)
      this.timer = null
    }
    this.open()
  }

  send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m))
  }

  close(): void {
    this.stopped = true
    if (this.timer !== null) (this.o.clearTimer ?? ((h) => clearTimeout(h as number)))(this.timer)
    this.ws?.close()
    this.o.onStatus('closed')
  }

  private open(): void {
    if (this.stopped) return
    this.o.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = (this.o.create ?? ((u) => new WebSocket(u) as unknown as WSLike))(this.o.url)
    this.ws = ws
    ws.onopen = async () => {
      const hello = await this.o.getHello()
      if (!hello) {
        // Only emit closed status if not already stopped by intentional close()
        const wasStopped = this.stopped
        this.stopped = true
        if (this.timer !== null) {
          (this.o.clearTimer ?? ((h) => clearTimeout(h as number)))(this.timer)
          this.timer = null
        }
        if (this.ws === ws) ws.close()
        if (!wasStopped) this.o.onStatus('closed', { code: 4002 })
        return
      }
      // Guard against stopped or socket change before sending hello
      if (this.stopped || this.ws !== ws) return
      ws.send(JSON.stringify(hello))
    }
    ws.onmessage = (e) => {
      let m: ServerMessage
      try {
        m = JSON.parse(e.data) as ServerMessage
      } catch {
        return
      }
      if (m.type === 'welcome') {
        this.attempt = 0
        this.o.onStatus('open')
      }
      this.o.onMessage(m)
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.stopped) return
      if (FATAL.has(e.code)) {
        this.stopped = true
        this.o.onStatus('closed', { code: e.code })
        return
      }
      const base = Math.min(15000, 500 * 2 ** this.attempt)
      const delay = base * (0.5 + (this.o.random ?? Math.random)() * 0.5)
      this.attempt++
      this.o.onStatus('reconnecting')
      this.timer = (this.o.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => this.open(), delay)
    }
  }
}
