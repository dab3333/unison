import { describe, it, expect } from 'vitest'
import { RoomManager } from '../src/roomManager'
import { createMemoryStores } from '../src/memoryStores'
import { record, OWNER } from './storeContract'
import { FakeConn } from './helpers'

function setup(over: { maxRooms?: number; idleMs?: number } = {}) {
  let t = 1_000_000
  const stores = createMemoryStores()
  const manager = new RoomManager({
    stores, now: () => t, nextId: () => crypto.randomUUID(), maxRooms: over.maxRooms ?? 100, idleMs: over.idleMs ?? 600_000,
  })
  return { stores, manager, advance: (ms: number) => (t += ms) }
}

describe('RoomManager', () => {
  it('creates one live Room per slug even for concurrent first joins', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec)
    const [a, b] = await Promise.all([manager.get(rec.slug), manager.get(rec.slug)])
    expect(a.ok && b.ok && a.room === b.room).toBe(true)
    expect(manager.peek(rec.slug)).toBeDefined()
  })

  it('returns not_found for unknown and closed rooms', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec); await stores.rooms.close(rec.id, 1)
    expect(await manager.get('nope')).toEqual({ ok: false, code: 'not_found' })
    expect(await manager.get(rec.slug)).toEqual({ ok: false, code: 'not_found' })
  })

  it('returns busy at the global room cap but still serves existing rooms', async () => {
    const { stores, manager } = setup({ maxRooms: 1 })
    const a = record(); const b = record()
    await stores.rooms.create(a); await stores.rooms.create(b)
    expect((await manager.get(a.slug)).ok).toBe(true)
    expect(await manager.get(b.slug)).toEqual({ ok: false, code: 'busy' })
    expect((await manager.get(a.slug)).ok).toBe(true)
  })

  it('applies persisted bans and the owner as host', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec); await stores.bans.add(rec.id, 'user:u2')
    const got = await manager.get(rec.slug)
    if (!got.ok) throw new Error('expected room')
    expect(got.room.hostId).toBe(OWNER)
    expect(got.room.join(new FakeConn('c1'), { id: 'u2', nickname: 'Leo', isGuest: false })).toEqual({ ok: false, code: 'banned' })
  })

  it('destroys rooms after they sit empty past idleMs, and recreates them fresh', async () => {
    const { stores, manager, advance } = setup({ idleMs: 600_000 })
    const rec = record(); await stores.rooms.create(rec)
    const first = await manager.get(rec.slug)
    if (!first.ok) throw new Error('expected room')
    const occupied = new FakeConn('c1')
    first.room.join(occupied, { id: 'u2', nickname: 'Leo', isGuest: false })
    advance(700_000); manager.tickAll()
    expect(manager.peek(rec.slug)).toBe(first.room) // occupied rooms are kept
    first.room.leave('c1')
    advance(599_999); manager.tickAll()
    expect(manager.peek(rec.slug)).toBeDefined()
    advance(1); manager.tickAll()
    expect(manager.peek(rec.slug)).toBeUndefined()
    const second = await manager.get(rec.slug)
    expect(second.ok && second.room !== first.room).toBe(true)
  })

  it('reports stats and closes a room by id', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec)
    const got = await manager.get(rec.slug)
    if (!got.ok) throw new Error('expected room')
    const c = new FakeConn('c1')
    got.room.join(c, { id: 'u2', nickname: 'Leo', isGuest: false })
    expect(manager.stats()).toEqual({ rooms: 1, sockets: 1 })
    manager.closeRoom(rec.id)
    expect(c.closed?.code).toBe(4005)
    expect(manager.stats()).toEqual({ rooms: 0, sockets: 0 })
  })
})
