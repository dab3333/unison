import { sourceSchema, type Source } from './protocol'

// C0/C1 controls, zero-width and bidi format characters, BOM.
const UNSAFE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g

export function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== 'string') return ''
  const cleaned = input.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(cleaned).slice(0, max).join('')
}

export function sanitizeNickname(input: unknown): string | null {
  return sanitizeText(input, 24) || null
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase()
  return h === '::' || h === '::1' || h.startsWith('::ffff:') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
}

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string }

export function validateSourceUrl(raw: string): UrlCheck {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid url' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'https required' }
  if (u.username || u.password) return { ok: false, reason: 'credentials not allowed' }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host.includes(':')) {
    if (isPrivateIPv6(host)) return { ok: false, reason: 'private address' }
  } else {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return { ok: false, reason: 'private host' }
    }
    if (isPrivateIPv4(host)) return { ok: false, reason: 'private address' }
    if (!host.includes('.')) return { ok: false, reason: 'single-label host' }
  }
  return { ok: true, url: u.toString() }
}

export function validateSource(raw: unknown): Source | null {
  const parsed = sourceSchema.safeParse(raw)
  if (!parsed.success) return null
  const s = parsed.data
  switch (s.type) {
    case 'youtube':
      return s.id && /^[A-Za-z0-9_-]{11}$/.test(s.id) ? { type: 'youtube', id: s.id } : null
    case 'url':
    case 'hls': {
      if (!s.url) return null
      const check = validateSourceUrl(s.url)
      return check.ok ? { type: s.type, url: check.url } : null
    }
    case 'file': {
      const name = sanitizeText(s.name, 200)
      if (!name || s.size === undefined || s.duration === undefined || s.duration <= 0) return null
      return { type: 'file', name, size: s.size, duration: s.duration }
    }
  }
}
