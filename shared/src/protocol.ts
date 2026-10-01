import { z } from 'zod'

export const sourceSchema = z
  .object({
    type: z.enum(['youtube', 'file', 'url', 'hls']),
    id: z.string().max(64).optional(),
    url: z.string().max(2048).optional(),
    name: z.string().max(200).optional(),
    size: z.number().finite().nonnegative().optional(),
    duration: z.number().finite().nonnegative().optional(),
  })
  .strict()
export type Source = z.infer<typeof sourceSchema>

export interface RoomState {
  source: Source | null
  isPlaying: boolean
  position: number
  rate: 1
  updatedAt: number
  version: number
}

export type Role = 'host' | 'moderator' | 'member' | 'guest'

export interface Member {
  id: string
  nickname: string
  role: Role
  muted: boolean
  buffering: boolean
}

export interface RoomSettings {
  controlMode: 'host' | 'everyone'
  allowGuests: boolean
  maxViewers: number
  chatEnabled: boolean
  pauseOnBuffering: boolean
}
export type PublicSettings = RoomSettings & { hasPassword: boolean }

export interface ChatMessage {
  id: string
  from: string
  nickname: string
  text: string
  at: number
}

export type ErrorCode =
  | 'forbidden'
  | 'rate_limited'
  | 'banned'
  | 'room_full'
  | 'bad_request'
  | 'not_found'
  | 'bad_password'
  | 'unauthorized'
  | 'stale'

export const settingsPatchSchema = z
  .object({
    controlMode: z.enum(['host', 'everyone']),
    allowGuests: z.boolean(),
    maxViewers: z.number().int().min(1).max(30),
    chatEnabled: z.boolean(),
    pauseOnBuffering: z.boolean(),
  })
  .partial()
  .strict()

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().min(1).max(4096), password: z.string().max(128).optional() }),
  z.object({ type: z.literal('ping'), t0: z.number().finite() }),
  z.object({
    type: z.literal('control'),
    version: z.number().int().nonnegative(),
    action: z.enum(['play', 'pause', 'seek', 'setSource']),
    position: z.number().finite().min(0).optional(),
    source: sourceSchema.optional(),
  }),
  z.object({ type: z.literal('chat'), text: z.string().max(2000) }),
  z.object({ type: z.literal('buffering'), value: z.boolean() }),
  z.object({
    type: z.literal('mod'),
    op: z.enum(['kick', 'mute', 'unmute', 'ban', 'promote', 'demote', 'deleteMessage']),
    target: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal('settings'), patch: settingsPatchSchema }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export type ServerMessage =
  | {
      type: 'welcome'
      you: string
      role: Role
      state: RoomState
      settings: PublicSettings
      members: Member[]
      chat: ChatMessage[]
      serverTime: number
    }
  | { type: 'pong'; t0: number; serverTime: number }
  | { type: 'state'; state: RoomState; holdingUp?: string[] }
  | { type: 'heartbeat'; state: RoomState; serverTime: number }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chatRemoved'; id: string }
  | { type: 'members'; members: Member[] }
  | { type: 'settings'; settings: PublicSettings }
  | { type: 'error'; code: ErrorCode; message: string }
