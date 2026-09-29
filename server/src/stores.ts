import type { RoomSettings } from '@unison/shared'

export interface RoomRecord {
  id: string
  slug: string
  ownerId: string
  ownerName: string
  name: string
  settings: RoomSettings
  passwordHash: string | null
  createdAt: number
  closedAt: number | null
}

export interface RoomStore {
  create(r: RoomRecord): Promise<void>
  getBySlug(slug: string): Promise<RoomRecord | null>
  getById(id: string): Promise<RoomRecord | null>
  listOpenByOwner(ownerId: string): Promise<RoomRecord[]>
  countCreatedSince(ownerId: string, sinceMs: number): Promise<number>
  close(id: string, at: number): Promise<void>
  saveSettings(id: string, settings: RoomSettings): Promise<void>
}
export interface BanStore {
  add(roomId: string, key: string): Promise<void>
  list(roomId: string): Promise<string[]>
}
export interface Report {
  roomId: string | null
  reporterId: string | null
  reason: string
  at: number
}
export interface ReportStore {
  add(r: Report): Promise<void>
}
export interface Stores {
  rooms: RoomStore
  bans: BanStore
  reports: ReportStore
}
