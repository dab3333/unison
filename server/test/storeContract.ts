import { describe, it, expect, beforeEach } from 'vitest'
import { SlugTakenError, type RoomRecord, type Stores } from '../src/stores'

const settings = { controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true } as const

export const OWNER = '00000000-0000-4000-8000-000000000001'

export function record(over: Partial<RoomRecord> = {}): RoomRecord {
  return {
    id: crypto.randomUUID(),
    slug: `slug-${Math.random().toString(36).slice(2, 10)}`,
    ownerId: OWNER,
    ownerName: 'Maya',
    name: 'Movie night',
    settings: { ...settings },
    passwordHash: null,
    createdAt: Date.now(),
    closedAt: null,
    ...over,
  }
}

/** Run against every Stores implementation. `make` must return empty stores whose owner rows already exist. */
export function runStoreContract(name: string, make: () => Promise<Stores> | Stores) {
  describe(`${name} stores`, () => {
    let s: Stores
    beforeEach(async () => { s = await make() })

    it('creates and fetches a room by slug and id', async () => {
      const r = record({ passwordHash: 'a:b' })
      await s.rooms.create(r)
      expect(await s.rooms.getBySlug(r.slug)).toEqual(r)
      expect(await s.rooms.getById(r.id)).toEqual(r)
      expect(await s.rooms.getBySlug('nope')).toBeNull()
    })
    it('refuses a second room with the same slug with SlugTakenError', async () => {
      const a = record(); await s.rooms.create(a)
      await expect(s.rooms.create(record({ slug: a.slug }))).rejects.toBeInstanceOf(SlugTakenError)
    })
    it('lists only open rooms for an owner and closes rooms', async () => {
      const a = record(); const b = record()
      await s.rooms.create(a); await s.rooms.create(b)
      await s.rooms.close(a.id, 5000)
      const open = await s.rooms.listOpenByOwner(OWNER)
      expect(open.map((r) => r.id)).toEqual([b.id])
      expect((await s.rooms.getById(a.id))?.closedAt).toBe(5000)
    })
    it('counts rooms created since a time', async () => {
      await s.rooms.create(record({ createdAt: 1000 }))
      await s.rooms.create(record({ createdAt: 9000 }))
      expect(await s.rooms.countCreatedSince(OWNER, 5000)).toBe(1)
    })
    it('saves settings', async () => {
      const r = record(); await s.rooms.create(r)
      await s.rooms.saveSettings(r.id, { ...r.settings, maxViewers: 7 })
      expect((await s.rooms.getById(r.id))?.settings.maxViewers).toBe(7)
    })
    it('stores bans idempotently', async () => {
      const r = record(); await s.rooms.create(r)
      await s.bans.add(r.id, 'guest:g1'); await s.bans.add(r.id, 'guest:g1'); await s.bans.add(r.id, 'ip:abc')
      expect((await s.bans.list(r.id)).sort()).toEqual(['guest:g1', 'ip:abc'])
    })
    it('stores reports', async () => {
      const r = record(); await s.rooms.create(r)
      await expect(s.reports.add({ roomId: r.id, reporterId: null, reason: 'spam', at: Date.now() })).resolves.toBeUndefined()
    })
  })
}
