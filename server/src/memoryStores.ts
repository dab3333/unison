import { SlugTakenError, type RoomRecord, type Stores, type Report } from './stores'

export function createMemoryStores(): Stores {
  const rooms = new Map<string, RoomRecord>()
  const bans = new Map<string, Set<string>>()
  const reports: Report[] = []
  const clone = (r: RoomRecord): RoomRecord => ({ ...r, settings: { ...r.settings } })
  return {
    rooms: {
      async create(r) {
        if ([...rooms.values()].some((x) => x.slug === r.slug)) throw new SlugTakenError() // like the unique index
        rooms.set(r.id, clone(r))
      },
      async getBySlug(slug) {
        const r = [...rooms.values()].find((x) => x.slug === slug)
        return r ? clone(r) : null
      },
      async getById(id) { const r = rooms.get(id); return r ? clone(r) : null },
      async listOpenByOwner(ownerId) {
        return [...rooms.values()].filter((r) => r.ownerId === ownerId && r.closedAt === null).map(clone)
      },
      async countCreatedSince(ownerId, sinceMs) {
        return [...rooms.values()].filter((r) => r.ownerId === ownerId && r.createdAt >= sinceMs).length
      },
      async close(id, at) { const r = rooms.get(id); if (r) r.closedAt = at },
      async saveSettings(id, settings) { const r = rooms.get(id); if (r) r.settings = { ...settings } },
    },
    bans: {
      async add(roomId, key) {
        if (!bans.has(roomId)) bans.set(roomId, new Set())
        bans.get(roomId)!.add(key)
      },
      async list(roomId) { return [...(bans.get(roomId) ?? [])] },
    },
    reports: { async add(r) { reports.push(r) } },
  }
}
