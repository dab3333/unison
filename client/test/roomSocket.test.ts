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
  const timerHandles = new Map<number, { fn: () => void; ms: number }>()
  const sock = new RoomSocket({
    url: 'ws://x/ws?room=r',
    getHello,
    onMessage: () => {},
    onStatus: (s, i) => statuses.push([s, i?.code]),
    create: (u) => new FakeWS(u),
    setTimer: (fn, ms) => {
      const handle = timers.length + 1
      const timer = { fn, ms }
      timers.push(timer)
      timerHandles.set(handle, timer)
      return handle
    },
    clearTimer: (h) => {
      const timer = timerHandles.get(h as number)
      if (timer) {
        timers.splice(timers.indexOf(timer), 1)
      }
    },
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

  it('does not reconnect after replaced, kicked, banned, closed, refused or rate-limit codes', () => {
    for (const code of [4001, 4002, 4003, 4004, 4005, 4006, 4008]) {
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

  it('a. null hello after socket close: no reconnect timer, status ends closed', async () => {
    let resolveHello: ((v: any) => void) | null = null
    const { sock, timers, statuses } = make(
      async () => new Promise(resolve => { resolveHello = resolve })
    )
    sock.connect()
    const ws = FakeWS.all[0]!
    const openPromise = ws.onopen!()

    // Socket closes while getHello is pending
    ws.onclose!({ code: 1006 })

    // Now getHello resolves null
    resolveHello!(null)
    await openPromise

    // No reconnect timer should be scheduled
    expect(timers).toHaveLength(0)
    expect(statuses.at(-1)).toEqual(['closed', 4002])
  })

  it('b. close() during getHello await: no send, no extra closed status after', async () => {
    let resolveHello: ((v: any) => void) | null = null
    const { sock, timers, statuses } = make(
      async () => new Promise(resolve => { resolveHello = resolve })
    )
    sock.connect()
    const ws = FakeWS.all[0]!
    const openPromise = ws.onopen!()

    // Give onopen time to await getHello
    await new Promise(r => setTimeout(r, 10))

    sock.close()
    ws.onclose!({ code: 1000 })

    // Resolve hello after close
    resolveHello!({ type: 'hello', token: 't' })
    await openPromise

    expect(ws.sent).toHaveLength(0)
    // Only one closed status from the explicit close, not from hello resolution
    expect(statuses).toEqual([['connecting', undefined], ['closed', undefined]])
  })

  it('c. close() then connect(): late onclose from old socket does not null new socket', async () => {
    const { sock, timers, statuses } = make()
    sock.connect()
    const ws1 = FakeWS.all[0]!
    const ws1Onclose = ws1.onclose!  // Save handler before it gets detached

    sock.close()
    sock.connect()
    const ws2 = FakeWS.all[1]!

    // Simulate late onclose from old socket
    ws1Onclose({ code: 1006 })

    // New socket should still be there and work
    await ws2.onopen!()
    ws2.readyState = 1
    sock.send({ type: 'ping', t0: 1 })
    expect(ws2.sent.filter(s => s.includes('ping'))).toHaveLength(1)
  })

  it('d. connect() called twice: first socket is closed, only second is live', async () => {
    const { sock, timers } = make()
    sock.connect()
    const ws1 = FakeWS.all[0]!
    sock.connect()
    const ws2 = FakeWS.all[1]!

    expect(ws1.closedByUs).toBe(true)
    await ws2.onopen!()
    ws2.readyState = 1
    sock.send({ type: 'ping', t0: 1 })
    expect(ws2.sent.filter(s => s.includes('ping'))).toHaveLength(1)
    expect(ws1.sent.filter(s => s.includes('ping'))).toHaveLength(0)
  })

  it('e. 4001 (replaced by another tab) is fatal: no reconnect loop between two tabs', () => {
    const { sock, timers, statuses } = make()
    sock.connect()
    FakeWS.all[0]!.onclose!({ code: 4001 })
    expect(timers).toHaveLength(0)
    expect(statuses.at(-1)).toEqual(['closed', 4001])
  })

  it('e2. an explicit connect() after a fatal close opens a fresh socket and says hello', async () => {
    const { sock, timers, statuses } = make()
    sock.connect()
    FakeWS.all[0]!.onclose!({ code: 1006 })
    timers[0]!.fn() // one failed attempt, so the backoff counter is non-zero
    FakeWS.all[1]!.onclose!({ code: 4001 })
    sock.connect()
    expect(FakeWS.all).toHaveLength(3)
    expect(statuses.at(-1)).toEqual(['connecting', undefined]) // a deliberate reconnect starts fresh
    await FakeWS.all[2]!.onopen!()
    expect(JSON.parse(FakeWS.all[2]!.sent[0]!)).toEqual({ type: 'hello', token: 't' })
  })

  it('f. getHello invoked again on each reconnect', async () => {
    let callCount = 0
    const { sock, timers } = make(async () => {
      callCount++
      return { type: 'hello', token: 't' }
    })

    sock.connect()
    const ws1 = FakeWS.all[0]!
    await ws1.onopen!()
    expect(callCount).toBe(1)

    ws1.onclose!({ code: 1006 })
    timers[0]!.fn()
    const ws2 = FakeWS.all[1]!
    await ws2.onopen!()
    expect(callCount).toBe(2)
  })
})
