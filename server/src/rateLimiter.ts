export class RateLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(t)
    this.hits.set(key, recent)
    return true
  }

  /** Would allow() pass right now? Does not record a hit. */
  wouldAllow(key: string): boolean {
    const t = this.now()
    return (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs).length < this.limit
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  /** Drops keys whose hits have all expired, so the map does not grow forever. */
  prune(): void {
    const t = this.now()
    for (const [key, hits] of this.hits) {
      if (hits.every((h) => t - h >= this.windowMs)) this.hits.delete(key)
    }
  }

  get size(): number {
    return this.hits.size
  }
}

/** Per-connection message limiter: `perSecond` sustained, up to `burst` at once. */
export class TokenBucket {
  private tokens: number
  private at: number

  constructor(
    private perSecond: number,
    private burst: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = burst
    this.at = now()
  }

  take(): boolean {
    const t = this.now()
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.perSecond)
    this.at = t
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}
