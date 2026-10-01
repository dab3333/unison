import type { IncomingMessage } from 'node:http'

/**
 * The client's IP, for rate limits and the IP hash. Behind Fly, `fly-client-ip` is set by the edge and cannot be
 * spoofed. Otherwise use the right-most X-Forwarded-For entry (added by the proxy in front of us); the left-most is
 * whatever the client sent. Without a trusted proxy, only the socket address counts.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fly = req.headers['fly-client-ip']
    if (typeof fly === 'string' && fly.trim()) return fly.trim()
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string') {
      const last = xff.split(',').map((s) => s.trim()).filter(Boolean).at(-1)
      if (last) return last
    }
  }
  return req.socket.remoteAddress ?? 'unknown'
}
