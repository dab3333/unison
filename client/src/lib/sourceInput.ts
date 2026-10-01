import { validateSourceUrl, type Source } from '@unison/shared'

export type ParsedInput = { ok: true; source: Source } | { ok: false; reason: string }

export function parseSourceInput(raw: string): ParsedInput {
  const text = raw.trim()
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return { ok: false, reason: 'Paste a full link starting with https://' }
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')
  let id: string | null | undefined
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0]
  } else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else id = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null
  } else {
    id = undefined
  }
  if (id !== undefined) {
    return id && /^[A-Za-z0-9_-]{11}$/.test(id)
      ? { ok: true, source: { type: 'youtube', id } }
      : { ok: false, reason: 'That does not look like a valid YouTube link.' }
  }
  const check = validateSourceUrl(text)
  if (!check.ok) return { ok: false, reason: 'Only public https links are supported.' }
  return { ok: true, source: { type: /\.m3u8$/i.test(u.pathname) ? 'hls' : 'url', url: check.url } }
}
