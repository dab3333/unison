import {
  validateSource,
  type ClientMessage,
  type ErrorCode,
  type Member,
  type PublicSettings,
  type Role,
  type RoomSettings,
  type ServerMessage,
} from '@unison/shared'
import { ChatService } from './chatService'
import type { Metrics } from './metrics'
import { can, canTarget, type Action } from './permissions'
import { RateLimiter } from './rateLimiter'
import { SyncEngine } from './syncEngine'

export interface Conn {
  id: string
  ipHash: string
  send(m: ServerMessage): void
  close(code: number, reason: string): void
}
export interface Identity {
  id: string
  nickname: string
  isGuest: boolean
}
export interface RoomDeps {
  now: () => number
  nextId: () => string
  hasPassword: boolean
  verifyPassword(pw: string | undefined): boolean
  persist: { ban(key: string): void; saveSettings(s: RoomSettings): void }
  metrics?: Metrics
}

interface Penalties {
  muted: boolean
  mutedUntil: number
  strikes: number[]
}

interface Entry {
  conn: Conn
  identity: Identity
  buffering: boolean
  /** Same object as in Room.penalties, so it survives replacement and rejoin. */
  pen: Penalties
}

type ModMsg = Extract<ClientMessage, { type: 'mod' }>
const MOD_ACTION: Record<ModMsg['op'], Action> = {
  kick: 'kick', mute: 'mute', unmute: 'mute', ban: 'ban', promote: 'promote', demote: 'promote', deleteMessage: 'deleteMessage',
}

const HEARTBEAT_MS = 5_000
const BUFFER_TIMEOUT_MS = 10_000
const STRIKE_WINDOW_MS = 60_000
const AUTO_MUTE_MS = 60_000
/** Resuming or pausing makes players stall briefly; buffering:true reports this soon after are ignored. */
const BUFFER_GRACE_MS = 1_500

export function banKeys(identity: Identity, ipHash: string): string[] {
  return identity.isGuest ? [`guest:${identity.id}`, `ip:${ipHash}`] : [`user:${identity.id}`]
}

export class Room {
  readonly engine: SyncEngine
  readonly chat: ChatService
  emptySince: number | null
  private entries = new Map<string, Entry>()
  private mods = new Set<string>()
  private penalties = new Map<string, Penalties>()
  private bans: Set<string>
  private settings: RoomSettings
  private controlLimiter: RateLimiter
  /** Buffering flag changes per member; more than this counts as a strike. */
  private bufferLimiter: RateLimiter
  /** Failed password attempts per IP hash; over the limit we answer without running scrypt. */
  private pwFailures: RateLimiter
  /** Identities that already gave the right password in this room (skip scrypt on rejoin). */
  private verified = new Set<string>()
  private autoPausedAt: number | null = null
  private lastMutedKey = ''
  /** When the server itself last paused or resumed playback (buffering auto-pause/resume or timeout). */
  private serverChangedAt: number | null = null
  private lastHeartbeat: number

  constructor(
    readonly id: string,
    readonly slug: string,
    readonly hostId: string,
    settings: RoomSettings,
    bans: Iterable<string>,
    private deps: RoomDeps,
  ) {
    this.settings = { ...settings }
    this.bans = new Set(bans)
    this.engine = new SyncEngine(deps.now)
    this.chat = new ChatService(deps.now, deps.nextId)
    this.controlLimiter = new RateLimiter(10, 10_000, deps.now)
    this.bufferLimiter = new RateLimiter(6, 10_000, deps.now)
    this.pwFailures = new RateLimiter(5, 60_000, deps.now)
    this.emptySince = deps.now()
    this.lastHeartbeat = deps.now()
  }

  get size(): number {
    return this.entries.size
  }

  publicSettings(): PublicSettings {
    return { ...this.settings, hasPassword: this.deps.hasPassword }
  }

  roleOf(id: string): Role {
    if (id === this.hostId) return 'host'
    if (this.mods.has(id)) return 'moderator'
    return this.entries.get(id)?.identity.isGuest ? 'guest' : 'member'
  }

  members(): Member[] {
    const t = this.deps.now()
    return [...this.entries.values()].map((e) => ({
      id: e.identity.id,
      nickname: e.identity.nickname,
      role: this.roleOf(e.identity.id),
      muted: e.pen.muted || e.pen.mutedUntil > t,
      buffering: e.buffering,
    }))
  }

  join(conn: Conn, identity: Identity, password?: string): { ok: true } | { ok: false; code: ErrorCode } {
    const isHost = identity.id === this.hostId
    if (banKeys(identity, conn.ipHash).some((k) => this.bans.has(k))) return { ok: false, code: 'banned' }
    if (identity.isGuest && !this.settings.allowGuests) return { ok: false, code: 'forbidden' }
    if (!isHost && this.deps.hasPassword && !this.verified.has(identity.id)) {
      if (!this.pwFailures.wouldAllow(conn.ipHash)) {
        this.deps.metrics?.inc('rateLimited')
        return { ok: false, code: 'rate_limited' }
      }
      if (!this.deps.verifyPassword(password)) {
        this.pwFailures.allow(conn.ipHash)
        return { ok: false, code: 'bad_password' }
      }
      this.verified.add(identity.id)
    }
    const existing = this.entries.get(identity.id)
    if (!existing && !isHost && this.entries.size >= this.settings.maxViewers) return { ok: false, code: 'room_full' }
    if (existing) {
      existing.conn.close(4001, 'replaced by a newer connection')
      this.deps.metrics?.inc('reconnectsReplaced')
    }
    this.deps.metrics?.inc('joins')
    let pen = this.penalties.get(identity.id)
    if (!pen) {
      pen = { muted: false, mutedUntil: 0, strikes: [] }
      this.penalties.set(identity.id, pen)
    }
    this.entries.set(identity.id, { conn, identity, buffering: false, pen })
    this.emptySince = null
    conn.send({
      type: 'welcome',
      you: identity.id,
      role: this.roleOf(identity.id),
      state: this.engine.state,
      settings: this.publicSettings(),
      members: this.members(),
      chat: this.chat.recent(),
      serverTime: this.deps.now(),
    })
    this.broadcastMembers()
    return { ok: true }
  }

  leave(connId: string): void {
    const entry = [...this.entries.values()].find((e) => e.conn.id === connId)
    if (!entry) return // stale close from a replaced connection
    const id = entry.identity.id
    this.entries.delete(id)
    this.chat.forget(id)
    this.controlLimiter.reset(id)
    this.bufferLimiter.reset(id)
    if (this.entries.size === 0) this.emptySince = this.deps.now()
    this.reevaluateBuffering()
    this.broadcastMembers()
  }

  handle(connId: string, msg: ClientMessage): void {
    const entry = [...this.entries.values()].find((e) => e.conn.id === connId)
    if (!entry) return
    switch (msg.type) {
      case 'hello':
        return this.err(entry, 'bad_request', 'already joined')
      case 'ping':
        return entry.conn.send({ type: 'pong', t0: msg.t0, serverTime: this.deps.now() })
      case 'control':
        return this.onControl(entry, msg)
      case 'chat':
        return this.onChat(entry, msg.text)
      case 'buffering':
        return this.onBuffering(entry, msg.value)
      case 'mod':
        return this.onMod(entry, msg)
      case 'settings':
        return this.onSettings(entry, msg.patch)
    }
  }

  /** Call about once a second: buffering timeout and heartbeat. */
  tick(): void {
    const t = this.deps.now()
    if (this.autoPausedAt !== null && t - this.autoPausedAt >= BUFFER_TIMEOUT_MS) {
      this.autoPausedAt = null
      this.serverChangedAt = t
      for (const e of this.entries.values()) e.buffering = false
      this.engine.setPlaying(true)
      this.broadcastState()
      this.broadcastMembers()
    }
    for (const [id, p] of this.penalties) {
      if (this.entries.has(id) || p.muted || p.mutedUntil > t) continue
      if (p.strikes.every((s) => t - s >= STRIKE_WINDOW_MS)) this.penalties.delete(id)
    }
    this.pwFailures.prune()
    // An automatic mute ends by the clock, not by a message: tell everyone so the member's chat input unlocks.
    if (this.mutedKey() !== this.lastMutedKey) this.broadcastMembers()
    if (t - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = t
      this.broadcast({ type: 'heartbeat', state: this.engine.state, serverTime: t })
    }
  }

  destroy(): void {
    for (const e of this.entries.values()) e.conn.close(4005, 'room closed')
    this.entries.clear()
    this.verified.clear()
  }

  private onControl(entry: Entry, msg: Extract<ClientMessage, { type: 'control' }>): void {
    const id = entry.identity.id
    if (!can(this.roleOf(id), 'control', this.settings)) return this.err(entry, 'forbidden')
    if (!this.controlLimiter.allow(id)) return this.strike(entry)
    let src
    if (msg.action === 'setSource') {
      src = validateSource(msg.source) ?? undefined
      if (!src) return this.err(entry, 'bad_request', 'invalid source')
    }
    const res = this.engine.apply(
      { action: msg.action, position: msg.position, source: src },
      msg.version,
      this.settings.controlMode === 'everyone',
    )
    if (!res.ok) return this.err(entry, res.code)
    this.autoPausedAt = null
    this.broadcastState()
  }

  private onChat(entry: Entry, text: string): void {
    const id = entry.identity.id
    if (this.roleOf(id) !== 'host' && !this.settings.chatEnabled) return this.err(entry, 'forbidden')
    if (entry.pen.muted) return this.err(entry, 'forbidden')
    if (entry.pen.mutedUntil > this.deps.now()) return this.strike(entry)
    const res = this.chat.post(entry.identity, text)
    if (!res.ok) return res.code === 'rate_limited' ? this.strike(entry) : this.err(entry, res.code)
    this.broadcast({ type: 'chat', message: res.message })
  }

  private onMod(actor: Entry, msg: ModMsg): void {
    const actorRole = this.roleOf(actor.identity.id)
    if (!can(actorRole, MOD_ACTION[msg.op], this.settings)) return this.err(actor, 'forbidden')
    if (msg.op === 'deleteMessage') {
      if (this.chat.remove(msg.target)) this.broadcast({ type: 'chatRemoved', id: msg.target })
      return
    }
    const target = this.entries.get(msg.target)
    if (!target) return this.err(actor, 'not_found')
    if (!canTarget(actorRole, this.roleOf(msg.target))) return this.err(actor, 'forbidden')
    switch (msg.op) {
      case 'kick':
        this.deps.metrics?.inc('kicks')
        return this.evict(target, 4003, 'kicked')
      case 'ban':
        for (const key of banKeys(target.identity, target.conn.ipHash)) {
          this.bans.add(key)
          this.deps.persist.ban(key)
        }
        this.verified.delete(target.identity.id)
        this.deps.metrics?.inc('bans')
        return this.evict(target, 4004, 'banned')
      case 'mute':
        target.pen.muted = true
        break
      case 'unmute':
        target.pen.muted = false
        target.pen.mutedUntil = 0
        break
      case 'promote':
        if (target.identity.isGuest) return this.err(actor, 'forbidden', 'guests cannot be moderators')
        this.mods.add(msg.target)
        break
      case 'demote':
        this.mods.delete(msg.target)
        break
    }
    this.broadcastMembers()
  }

  private onSettings(entry: Entry, patch: Partial<RoomSettings>): void {
    if (!can(this.roleOf(entry.identity.id), 'settings', this.settings)) return this.err(entry, 'forbidden')
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    const next = { ...this.settings, ...defined } as RoomSettings
    next.maxViewers = Math.min(30, Math.max(1, Math.floor(next.maxViewers)))
    this.settings = next
    this.deps.persist.saveSettings({ ...next })
    this.broadcast({ type: 'settings', settings: this.publicSettings() })
  }

  private evict(entry: Entry, code: number, reason: string): void {
    entry.conn.close(code, reason)
    this.leave(entry.conn.id)
  }

  private onBuffering(entry: Entry, value: boolean): void {
    if (entry.buffering === value) return // nothing changed: no broadcast
    const t = this.deps.now()
    if (value && this.serverChangedAt !== null && t - this.serverChangedAt < BUFFER_GRACE_MS) return
    if (!this.bufferLimiter.allow(entry.identity.id)) {
      this.strike(entry)
      if (this.entries.get(entry.identity.id) !== entry) return // the strike disconnected them
      if (value) return // clearing a flag is always safe; setting one is what pauses everyone
    }
    entry.buffering = value
    this.reevaluateBuffering()
    this.broadcastMembers()
  }

  /** Pauses or resumes the room for buffering. Callers broadcast members. */
  private reevaluateBuffering(): void {
    if (!this.settings.pauseOnBuffering) return
    const holding = [...this.entries.values()].filter((e) => e.buffering).map((e) => e.identity.id)
    if (holding.length > 0 && this.engine.state.isPlaying) {
      this.engine.setPlaying(false)
      this.autoPausedAt = this.serverChangedAt = this.deps.now()
      this.broadcastState(holding)
    } else if (holding.length === 0 && this.autoPausedAt !== null) {
      this.autoPausedAt = null
      this.serverChangedAt = this.deps.now()
      this.engine.setPlaying(true)
      this.broadcastState()
    }
  }

  private strike(entry: Entry): void {
    const t = this.deps.now()
    const pen = entry.pen
    pen.strikes = pen.strikes.filter((s) => t - s < STRIKE_WINDOW_MS)
    pen.strikes.push(t)
    this.deps.metrics?.inc('rateLimited')
    this.err(entry, 'rate_limited')
    if (pen.strikes.length >= 10) {
      this.evict(entry, 4008, 'rate limit exceeded')
    } else if (pen.strikes.length === 5) {
      pen.mutedUntil = t + AUTO_MUTE_MS
      this.broadcastMembers()
    }
  }

  private err(entry: Entry, code: ErrorCode, message: string = code): void {
    entry.conn.send({ type: 'error', code, message })
  }

  private broadcast(m: ServerMessage): void {
    for (const e of this.entries.values()) e.conn.send(m)
  }
  private broadcastState(holdingUp?: string[]): void {
    this.broadcast({ type: 'state', state: this.engine.state, ...(holdingUp ? { holdingUp } : {}) })
  }
  private broadcastMembers(): void {
    this.lastMutedKey = this.mutedKey()
    this.broadcast({ type: 'members', members: this.members() })
  }
  /** Which members are muted right now, as a comparable string. */
  private mutedKey(): string {
    return this.members().filter((m) => m.muted).map((m) => m.id).sort().join('|')
  }
}
