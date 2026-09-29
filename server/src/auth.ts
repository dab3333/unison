import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose'
import { sanitizeNickname } from '@unison/shared'

export interface AuthIdentity {
  id: string
  nickname: string
  isGuest: boolean
}
export interface Auth {
  verify(token: string): Promise<AuthIdentity | null>
  issueGuest(nickname: string, id: string): Promise<string>
}
export interface AuthConfig {
  guestSecret: string
  supabaseJwtSecret?: string
  supabaseJwksUrl?: string
}

export function createAuth(cfg: AuthConfig): Auth {
  const guestKey = new TextEncoder().encode(cfg.guestSecret)
  const jwks = cfg.supabaseJwksUrl ? createRemoteJWKSet(new URL(cfg.supabaseJwksUrl)) : null
  const sbSecret = cfg.supabaseJwtSecret ? new TextEncoder().encode(cfg.supabaseJwtSecret) : null

  async function verifyGuest(token: string): Promise<AuthIdentity | null> {
    try {
      const { payload } = await jwtVerify(token, guestKey, { algorithms: ['HS256'] })
      const nickname = sanitizeNickname(payload.nick)
      if (payload.kind !== 'guest' || typeof payload.sub !== 'string' || !nickname) return null
      return { id: payload.sub, nickname, isGuest: true }
    } catch {
      return null
    }
  }

  async function verifySupabase(token: string): Promise<AuthIdentity | null> {
    try {
      const { payload } = jwks
        ? await jwtVerify(token, jwks, { audience: 'authenticated' })
        : sbSecret
          ? await jwtVerify(token, sbSecret, { algorithms: ['HS256'], audience: 'authenticated' })
          : (null as never)
      if (typeof payload.sub !== 'string') return null
      const meta = (payload.user_metadata ?? {}) as Record<string, unknown>
      const email = typeof payload.email === 'string' ? payload.email : ''
      const nickname =
        sanitizeNickname(meta.full_name) ??
        sanitizeNickname(meta.name) ??
        sanitizeNickname(meta.user_name) ??
        sanitizeNickname(email.split('@')[0]) ??
        'Host'
      return { id: payload.sub, nickname, isGuest: false }
    } catch {
      return null
    }
  }

  return {
    async verify(token) {
      return (await verifyGuest(token)) ?? (await verifySupabase(token))
    },
    issueGuest(nickname, id) {
      return new SignJWT({ kind: 'guest', nick: nickname })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(id)
        .setIssuedAt()
        .setExpirationTime('30d')
        .sign(guestKey)
    },
  }
}
