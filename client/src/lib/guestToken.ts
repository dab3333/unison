export interface StoredGuest { token: string; nickname: string }

/** Tokens this close to expiry are treated as expired, so a join does not fail seconds later. */
const SKEW_MS = 60_000

/** Reads the JWT `exp` claim without verifying it (the server verifies). Malformed tokens count as expired. */
export function tokenExpired(token: string, nowMs: number): boolean {
  const part = token.split('.')[1]
  if (!part) return true
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' && exp * 1000 <= nowMs + SKEW_MS
  } catch {
    return true
  }
}

/** The stored guest token, if it can be reused for this nickname. */
export function reusableGuestToken(stored: StoredGuest | null, nickname: string, nowMs: number): string | null {
  if (!stored || stored.nickname !== nickname || tokenExpired(stored.token, nowMs)) return null
  return stored.token
}
