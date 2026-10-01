import type { PublicSettings, RoomSettings } from '@unison/shared'
import { API_URL } from './config'

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

async function req<T>(path: string, o: { method?: string; token?: string | null; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: o.method ?? 'GET',
    headers: {
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'error')
  return json as T
}

export interface RoomInfo { slug: string; name: string; ownerName: string; live: number; settings: PublicSettings }
export interface MyRoom { id: string; slug: string; name: string; live: number; settings: PublicSettings; createdAt: number }

export const api = {
  roomInfo: (slug: string) => req<RoomInfo>(`/rooms/${encodeURIComponent(slug)}`),
  createGuest: (nickname: string) => req<{ token: string; id: string; nickname: string }>('/guest', { method: 'POST', body: { nickname } }),
  createRoom: (token: string, body: { name: string; password?: string; settings?: Partial<RoomSettings> }) =>
    req<{ id: string; slug: string }>('/rooms', { method: 'POST', token, body }),
  listRooms: (token: string) => req<MyRoom[]>('/rooms', { token }),
  closeRoom: (token: string, id: string) => req<void>(`/rooms/${id}`, { method: 'DELETE', token }),
  report: (slug: string, reason: string, token?: string | null) =>
    req<{ ok: true }>(`/rooms/${encodeURIComponent(slug)}/report`, { method: 'POST', token, body: { reason } }),
}

export function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'too_many_rooms') return 'You already have 3 open rooms. Close one first.'
    if (err.code === 'daily_limit') return 'Daily room limit reached. Try again tomorrow.'
    if (err.code === 'rate_limited') return 'Too many requests. Wait a minute and try again.'
    if (err.code === 'bad_nickname') return 'Pick a nickname.'
  }
  return 'Something went wrong. Please try again.'
}
