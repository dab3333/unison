import { sanitizeText, type ChatMessage } from '@unison/shared'
import { RateLimiter } from './rateLimiter'

export type PostResult = { ok: true; message: ChatMessage } | { ok: false; code: 'rate_limited' | 'bad_request' }

export class ChatService {
  private history: ChatMessage[] = []
  private memberLimiter: RateLimiter
  private guestLimiter: RateLimiter

  constructor(
    private now: () => number,
    private nextId: () => string,
    private max = 100,
  ) {
    this.memberLimiter = new RateLimiter(5, 10_000, now)
    this.guestLimiter = new RateLimiter(3, 10_000, now)
  }

  post(from: { id: string; nickname: string; isGuest: boolean }, raw: unknown): PostResult {
    const text = sanitizeText(raw, 500)
    if (!text) return { ok: false, code: 'bad_request' }
    const limiter = from.isGuest ? this.guestLimiter : this.memberLimiter
    if (!limiter.allow(from.id)) return { ok: false, code: 'rate_limited' }
    const message: ChatMessage = { id: this.nextId(), from: from.id, nickname: from.nickname, text, at: this.now() }
    this.history.push(message)
    if (this.history.length > this.max) this.history.shift()
    return { ok: true, message }
  }

  remove(id: string): boolean {
    const i = this.history.findIndex((m) => m.id === id)
    if (i < 0) return false
    this.history.splice(i, 1)
    return true
  }

  recent(): ChatMessage[] {
    return [...this.history]
  }

  forget(memberId: string): void {
    this.memberLimiter.reset(memberId)
    this.guestLimiter.reset(memberId)
  }
}
