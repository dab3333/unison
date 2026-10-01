import { createHash } from 'node:crypto'

const DAY_MS = 86_400_000

/** Salted, daily-rotating hash so raw IPs are never stored and hashes cannot be linked across days. */
export function hashIp(ip: string, secret: string, nowMs: number): string {
  const day = Math.floor(nowMs / DAY_MS)
  return createHash('sha256').update(`${secret}:${day}:${ip}`).digest('hex').slice(0, 32)
}
