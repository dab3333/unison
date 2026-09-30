import type { RoomSettings, ServerMessage } from '@unison/shared'
import { Metrics } from '../src/metrics'
import { Room, type Conn, type Identity } from '../src/room'

export class FakeConn implements Conn {
  sent: ServerMessage[] = []
  closed: { code: number; reason: string } | null = null
  constructor(public id: string, public ipHash = `ip-${id}`) {}
  send(m: ServerMessage) { this.sent.push(m) }
  close(code: number, reason: string) { this.closed = { code, reason } }
  all<T extends ServerMessage['type']>(type: T) {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[]
  }
  last<T extends ServerMessage['type']>(type: T) {
    return this.all(type).at(-1)
  }
}

export const defaultSettings: RoomSettings = {
  controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true,
}

export const host = (): Identity => ({ id: 'host-1', nickname: 'Maya', isGuest: false })
export const user = (id = 'u2', nickname = 'Leo'): Identity => ({ id, nickname, isGuest: false })
export const guest = (id = 'g1', nickname = 'Pat'): Identity => ({ id, nickname, isGuest: true })

export function makeRoom(over: { settings?: Partial<RoomSettings>; bans?: string[]; password?: string } = {}) {
  let t = 1_000_000
  let n = 0
  let verifyCalls = 0
  const persisted = { bans: [] as string[], settings: [] as RoomSettings[] }
  const metrics = new Metrics()
  const room = new Room('room-1', 'quiet-otter-42', 'host-1', { ...defaultSettings, ...over.settings }, over.bans ?? [], {
    now: () => t,
    nextId: () => `id-${++n}`,
    hasPassword: !!over.password,
    verifyPassword: (pw) => {
      verifyCalls++
      return !over.password || pw === over.password
    },
    persist: { ban: (k) => persisted.bans.push(k), saveSettings: (s) => persisted.settings.push(s) },
    metrics,
  })
  return { room, persisted, metrics, advance: (ms: number) => (t += ms), now: () => t, verifyCalls: () => verifyCalls }
}

/** Join an identity with a fresh FakeConn and return it. */
export function joinAs(room: Room, identity: Identity, connId = `c-${identity.id}`, password?: string, ipHash?: string) {
  const conn = new FakeConn(connId, ipHash)
  const result = room.join(conn, identity, password)
  return { conn, result }
}

export const source = { type: 'file', name: 'a.mp4', size: 1, duration: 600 } as const
