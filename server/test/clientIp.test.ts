import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientIp } from '../src/clientIp'

const req = (headers: Record<string, string>, remoteAddress = '192.0.2.1') =>
  ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage

describe('clientIp', () => {
  it('uses the socket address unless the proxy is trusted', () => {
    expect(clientIp(req({ 'fly-client-ip': '203.0.113.5', 'x-forwarded-for': '10.0.0.1' }), false)).toBe('192.0.2.1')
  })
  it('prefers fly-client-ip when trusting the proxy', () => {
    expect(clientIp(req({ 'fly-client-ip': '203.0.113.5', 'x-forwarded-for': '10.0.0.1, 203.0.113.9' }), true)).toBe('203.0.113.5')
  })
  it('falls back to the right-most X-Forwarded-For entry (the one the proxy added), not the client-controlled left-most', () => {
    expect(clientIp(req({ 'x-forwarded-for': '10.6.6.6, 203.0.113.9' }), true)).toBe('203.0.113.9')
  })
})
