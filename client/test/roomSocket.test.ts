import { describe, it, expect } from 'vitest'
import { RoomSocket, type WSLike } from '../src/net/roomSocket'

class FakeWS implements WSLike {
  static all: FakeWS[] = []
  readyState = 1
  sent: string[] = []
  closedByUs = false
  onopen: (() => void | Promise<void>) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(public url: string) { FakeWS.all.push(this) }
  send(d: string) { this.sent.push(d) }
  close() { this.closedByUs = true }
}

function make(getHello: () => Promise<any> = async () => ({ type: 'hello', token: 't' })) {
  FakeWS.all = []
  const timers: { fn: () => void; ms: number }[] = []
  const statuses: Array<[string, number | undefined]> = []
  const sock = new RoomSocket({
    url: 'ws://x/ws?room=r',
    getHello,
    onMessage: () => {},
    onStatus: (s, i) => statuses.push([s, i?.code]),
    create: (u) => new FakeWS(u),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
    random: () => 1,
  })
  return { sock, timers, statuses }
}
const welcome = JSON.stringify({ type: 'welcome' })

describe('RoomSocket', () => {
  it('sends hello when the socket opens', async () => {
    const { sock } = make()
    sock.connect()
    const ws = FakeWS.all[0]!
    await ws.onopen!()
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'hello', token: 't' })
  })

  it('reconnects with exponential backoff, and a welcome resets the backoff', async () => {
    const { sock, timers, statuses } = make()
    sock.connect()
    FakeWS.all[0]!.onclose!({ code: 1006 })
    expect(timers[0]!.ms).toBe(500)
    timers[0]!.fn()
    FakeWS.all[1]!.onclose!({ code: 1006 })
    expect(timers[1]!.ms).toBe(1000)
    timers[1]!.fn()
    FakeWS.all[2]!.onmessage!({ data: welcome })
    expect(statuses.at(-1)![0]).toBe('open')
    FakeWS.all[2]!.onclose!({ code: 1006 })
    expect(timers[2]!.ms).toBe(500)
  })

  it('caps the backoff at 15 seconds', () => {
    const { sock, timers } = make()
    sock.connect()
    for (let i = 0; i < 8; i++) {
      FakeWS.all.at(-1)!.onclose!({ code: 1006 })
      timers.at(-1)!.fn()
    }
    FakeWS.all.at(-1)!.onclose!({ code: 1006 })
    expect(timers.at(-1)!.ms).toBe(15000)
  })

  it('does not reconnect after kicked, banned, closed, refused or rate-limit codes', () => {
    for (const code of [4002, 4003, 4004, 4005, 4006, 4008]) {
      const { sock, timers, statuses } = make()
      sock.connect()
      FakeWS.all[0]!.onclose!({ code })
      expect(timers).toHaveLength(0)
      expect(statuses.at(-1)).toEqual(['closed', code])
    }
  })

  it('stops when there is no identity to say hello with', async () => {
    const { sock, statuses } = make(async () => null)
    sock.connect()
    const ws = FakeWS.all[0]!
    await ws.onopen!()
    expect(ws.closedByUs).toBe(true)
    expect(statuses.at(-1)![0]).toBe('closed')
  })

  it('does not reconnect after close(), and only sends while open', () => {
    const { sock, timers } = make()
    sock.connect()
    const ws = FakeWS.all[0]!
    sock.send({ type: 'ping', t0: 1 })
    expect(ws.sent).toHaveLength(1)
    sock.close()
    ws.onclose!({ code: 1000 })
    expect(timers).toHaveLength(0)
    ws.readyState = 3
    sock.send({ type: 'ping', t0: 2 })
    expect(ws.sent).toHaveLength(1)
  })
})
