/** Launch counters for /stats. Monotonic since process start; no chat, IPs or identities. */
export type MetricName = 'joins' | 'rateLimited' | 'reports' | 'kicks' | 'bans' | 'reconnectsReplaced'

export class Metrics {
  private c: Record<MetricName, number> = { joins: 0, rateLimited: 0, reports: 0, kicks: 0, bans: 0, reconnectsReplaced: 0 }

  inc(name: MetricName): void {
    this.c[name]++
  }

  snapshot(): Record<MetricName, number> {
    return { ...this.c }
  }
}
