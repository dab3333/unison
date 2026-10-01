import { describe, it, expect } from 'vitest'
import { ChatService } from '../src/chatService'

function setup(max?: number) {
  let t = 0
  let n = 0
  const chat = new ChatService(() => t, () => `m${++n}`, max)
  return { chat, advance: (ms: number) => (t += ms) }
}
const member = { id: 'u1', nickname: 'Leo', isGuest: false }
const guest = { id: 'g1', nickname: 'Pat', isGuest: true }

describe('ChatService', () => {
  it('stores sanitized messages with sender and timestamp', () => {
    const { chat } = setup()
    const r = chat.post(member, '  hello\u0000 world  ')
    expect(r).toEqual({ ok: true, message: { id: 'm1', from: 'u1', nickname: 'Leo', text: 'hello world', at: 0 } })
    expect(chat.recent()).toHaveLength(1)
  })
  it('rejects empty, whitespace-only and non-string text', () => {
    const { chat } = setup()
    expect(chat.post(member, '   ')).toEqual({ ok: false, code: 'bad_request' })
    expect(chat.post(member, 5)).toEqual({ ok: false, code: 'bad_request' })
  })
  it('truncates to 500 characters', () => {
    const { chat } = setup()
    const r = chat.post(member, 'x'.repeat(900))
    expect(r.ok && r.message.text.length).toBe(500)
  })
  it('limits members to 5 messages per 10s and guests to 3', () => {
    const { chat } = setup()
    const m = Array.from({ length: 6 }, () => chat.post(member, 'hi').ok)
    const g = Array.from({ length: 4 }, () => chat.post(guest, 'hi').ok)
    expect(m).toEqual([true, true, true, true, true, false])
    expect(g).toEqual([true, true, true, false])
    expect(chat.post(member, 'again')).toEqual({ ok: false, code: 'rate_limited' })
  })
  it('recovers after the window', () => {
    const { chat, advance } = setup()
    for (let i = 0; i < 3; i++) chat.post(guest, 'hi')
    advance(10_001)
    expect(chat.post(guest, 'hi').ok).toBe(true)
  })
  it('keeps only the most recent messages', () => {
    const { chat, advance } = setup(3)
    for (let i = 0; i < 5; i++) { chat.post(member, `msg${i}`); advance(3000) }
    expect(chat.recent().map((m) => m.text)).toEqual(['msg2', 'msg3', 'msg4'])
  })
  it('removes a message by id', () => {
    const { chat } = setup()
    chat.post(member, 'bad')
    expect(chat.remove('m1')).toBe(true)
    expect(chat.remove('m1')).toBe(false)
    expect(chat.recent()).toEqual([])
  })
})
