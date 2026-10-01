import type { Metrics } from './metrics'
import { checkPassword } from './password'
import { Room } from './room'
import type { Stores } from './stores'

export interface ManagerDeps {
  stores: Stores
  now: () => number
  nextId: () => string
  maxRooms: number
  idleMs: number
  metrics?: Metrics
}
export type GetResult = { ok: true; room: Room } | { ok: false; code: 'not_found' | 'busy' }

export class RoomManager {
  private live = new Map<string, Room>()
  private pending = new Map<string, Promise<GetResult>>()

  constructor(private d: ManagerDeps) {}

  get(slug: string): Promise<GetResult> {
    const existing = this.live.get(slug)
    if (existing) return Promise.resolve({ ok: true, room: existing })
    let p = this.pending.get(slug)
    if (!p) {
      p = this.create(slug).finally(() => this.pending.delete(slug))
      this.pending.set(slug, p)
    }
    return p
  }

  peek(slug: string): Room | undefined {
    return this.live.get(slug)
  }

  closeRoom(roomId: string): void {
    for (const [slug, room] of this.live) {
      if (room.id === roomId) {
        room.destroy()
        this.live.delete(slug)
      }
    }
  }

  tickAll(): void {
    const t = this.d.now()
    for (const [slug, room] of this.live) {
      room.tick()
      if (room.emptySince !== null && t - room.emptySince >= this.d.idleMs) {
        room.destroy()
        this.live.delete(slug)
      }
    }
  }

  stats(): { rooms: number; sockets: number } {
    let sockets = 0
    for (const room of this.live.values()) sockets += room.size
    return { rooms: this.live.size, sockets }
  }

  private async create(slug: string): Promise<GetResult> {
    const rec = await this.d.stores.rooms.getBySlug(slug)
    if (!rec || rec.closedAt !== null) return { ok: false, code: 'not_found' }
    if (this.live.size >= this.d.maxRooms) return { ok: false, code: 'busy' }
    const bans = await this.d.stores.bans.list(rec.id)
    const room = new Room(rec.id, rec.slug, rec.ownerId, rec.settings, bans, {
      now: this.d.now,
      nextId: this.d.nextId,
      hasPassword: rec.passwordHash !== null,
      verifyPassword: (pw) => checkPassword(pw, rec.passwordHash),
      metrics: this.d.metrics,
      persist: {
        ban: (key) => void this.d.stores.bans.add(rec.id, key).catch(() => {}),
        saveSettings: (s) => void this.d.stores.rooms.saveSettings(rec.id, s).catch(() => {}),
      },
    })
    this.live.set(slug, room)
    return { ok: true, room }
  }
}
