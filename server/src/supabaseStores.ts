import { createClient } from '@supabase/supabase-js'
import type { RoomSettings } from '@unison/shared'
import type { RoomRecord, Stores } from './stores'

interface Row {
  id: string
  slug: string
  owner_id: string
  owner_name: string
  name: string
  settings: RoomSettings
  password_hash: string | null
  created_at: string
  closed_at: string | null
}

const toRecord = (r: Row): RoomRecord => ({
  id: r.id,
  slug: r.slug,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  name: r.name,
  settings: r.settings,
  passwordHash: r.password_hash,
  createdAt: new Date(r.created_at).getTime(),
  closedAt: r.closed_at ? new Date(r.closed_at).getTime() : null,
})
const iso = (ms: number) => new Date(ms).toISOString()

export function createSupabaseStores(url: string, serviceKey: string): Stores {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message)
  }
  return {
    rooms: {
      async create(r) {
        const { error } = await db.from('rooms').insert({
          id: r.id, slug: r.slug, owner_id: r.ownerId, owner_name: r.ownerName, name: r.name,
          settings: r.settings, password_hash: r.passwordHash, created_at: iso(r.createdAt),
          closed_at: r.closedAt === null ? null : iso(r.closedAt),
        })
        check(error)
      },
      async getBySlug(slug) {
        const { data, error } = await db.from('rooms').select('*').eq('slug', slug).maybeSingle()
        check(error)
        return data ? toRecord(data as Row) : null
      },
      async getById(id) {
        const { data, error } = await db.from('rooms').select('*').eq('id', id).maybeSingle()
        check(error)
        return data ? toRecord(data as Row) : null
      },
      async listOpenByOwner(ownerId) {
        const { data, error } = await db.from('rooms').select('*').eq('owner_id', ownerId).is('closed_at', null)
          .order('created_at', { ascending: false })
        check(error)
        return (data as Row[]).map(toRecord)
      },
      async countCreatedSince(ownerId, sinceMs) {
        const { count, error } = await db.from('rooms').select('id', { count: 'exact', head: true })
          .eq('owner_id', ownerId).gte('created_at', iso(sinceMs))
        check(error)
        return count ?? 0
      },
      async close(id, at) {
        check((await db.from('rooms').update({ closed_at: iso(at) }).eq('id', id)).error)
      },
      async saveSettings(id, settings) {
        check((await db.from('rooms').update({ settings }).eq('id', id)).error)
      },
    },
    bans: {
      async add(roomId, key) {
        check((await db.from('bans').upsert({ room_id: roomId, key }, { onConflict: 'room_id,key', ignoreDuplicates: true })).error)
      },
      async list(roomId) {
        const { data, error } = await db.from('bans').select('key').eq('room_id', roomId)
        check(error)
        return (data as { key: string }[]).map((b) => b.key)
      },
    },
    reports: {
      async add(r) {
        check((await db.from('reports').insert({ room_id: r.roomId, reporter_id: r.reporterId, reason: r.reason,
          created_at: iso(r.at) })).error)
      },
    },
  }
}
