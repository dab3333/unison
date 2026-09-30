import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ClientMessage, ErrorCode, Member, PublicSettings, Role, RoomState, Source } from '@unison/shared'
import { WS_URL } from '../lib/config'
import { getIdentity } from '../lib/identity'
import { RoomSocket, type SocketStatus } from '../net/roomSocket'
import { SyncClient } from '../sync/syncClient'
import { canControlPlayback } from './permissions'
import { errorText, type SentKind } from './roomErrors'

export interface RoomView {
  status: SocketStatus
  closeCode: number | null
  /** The last server error code before a terminal close (e.g. bad_password with 4006). */
  joinError: ErrorCode | null
  me: { id: string; role: Role } | null
  state: RoomState | null
  settings: PublicSettings | null
  members: Member[]
  chat: ChatMessage[]
  source: Source | null
  blocked: boolean
  mismatch: { expected: number; actual: number } | null
  toast: string | null
  sync: SyncClient
  send(m: ClientMessage): void
  /** A deliberate reconnect after a terminal close (e.g. "Use here" or a new password). */
  reconnect(): void
  clearBlocked(): void
  dismissToast(): void
}

export function useRoom(slug: string): RoomView {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const [closeCode, setCloseCode] = useState<number | null>(null)
  const [joinError, setJoinError] = useState<ErrorCode | null>(null)
  const [me, setMe] = useState<{ id: string; role: Role } | null>(null)
  const [state, setState] = useState<RoomState | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [source, setSource] = useState<Source | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [mismatch, setMismatch] = useState<{ expected: number; actual: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const socketRef = useRef<RoomSocket | null>(null)
  const syncRef = useRef<SyncClient | null>(null)
  const lastErrorRef = useRef<ErrorCode | null>(null)
  const lastSentRef = useRef<SentKind>(null)
  // Updated straight from server messages (not on render) so the SyncClient always sees the current role and mode.
  const roleRef = useRef<Role | undefined>(undefined)
  const meIdRef = useRef<string | null>(null)
  const modeRef = useRef<PublicSettings['controlMode'] | undefined>(undefined)
  // Every outgoing message goes through here, so an error reply can be matched to the kind of request that caused it.
  const out = useCallback((m: ClientMessage) => {
    if (m.type === 'control' || m.type === 'chat' || m.type === 'mod' || m.type === 'settings') lastSentRef.current = m.type
    socketRef.current?.send(m)
  }, [])

  if (!syncRef.current) {
    syncRef.current = new SyncClient({
      send: out,
      now: Date.now,
      onSource: setSource,
      onBlocked: () => setBlocked(true),
      onMismatch: setMismatch,
      onState: setState,
      canControl: () => canControlPlayback(roleRef.current, modeRef.current),
    })
  }
  const sync = syncRef.current

  useEffect(() => {
    let clockTimer: ReturnType<typeof setInterval> | undefined
    const sock = new RoomSocket({
      url: `${WS_URL}?room=${encodeURIComponent(slug)}`,
      getHello: async () => {
        const id = await getIdentity()
        if (!id) return null
        let password: string | undefined
        try {
          password = sessionStorage.getItem(`unison.pw.${slug}`) ?? undefined
        } catch { /* private mode */ }
        return { type: 'hello', token: id.token, password }
      },
      onStatus: (s, info) => {
        setStatus(s)
        // A new connect attempt clears any earlier terminal code; an intentional close has no code.
        if (s === 'connecting') {
          setCloseCode(null)
          setJoinError(null)
          lastErrorRef.current = null
        }
        if (info) {
          setCloseCode(info.code)
          setJoinError(lastErrorRef.current)
        }
      },
      onMessage: (m) => {
        sync.handleServer(m)
        switch (m.type) {
          case 'welcome':
            lastErrorRef.current = null
            roleRef.current = m.role
            meIdRef.current = m.you
            modeRef.current = m.settings.controlMode
            setMe({ id: m.you, role: m.role })
            setSettings(m.settings)
            setMembers(m.members)
            setChat(m.chat)
            sync.startClockSync()
            clearInterval(clockTimer)
            clockTimer = setInterval(() => sync.startClockSync(), 60_000)
            break
          case 'chat':
            setChat((c) => [...c, m.message].slice(-200))
            break
          case 'chatRemoved':
            setChat((c) => c.filter((x) => x.id !== m.id))
            break
          case 'members': {
            const self = m.members.find((x) => x.id === meIdRef.current)
            if (self) roleRef.current = self.role
            setMembers(m.members)
            setMe((prev) => {
              const mine = prev && m.members.find((x) => x.id === prev.id)
              return prev && mine && mine.role !== prev.role ? { ...prev, role: mine.role } : prev
            })
            break
          }
          case 'settings':
            modeRef.current = m.settings.controlMode
            setSettings(m.settings)
            break
          case 'error': {
            lastErrorRef.current = m.code
            const text = errorText(m.code, lastSentRef.current)
            if (text) setToast(text)
            break
          }
        }
      },
    })
    socketRef.current = sock
    sock.connect()
    return () => {
      clearInterval(clockTimer)
      sock.close()
    }
  }, [slug, sync])

  const reconnect = useCallback(() => socketRef.current?.connect(), [])
  const clearBlocked = useCallback(() => setBlocked(false), [])
  const dismissToast = useCallback(() => setToast(null), [])

  return {
    status, closeCode, joinError, me, state, settings, members, chat, source, blocked, mismatch, toast, sync,
    send: out, reconnect, clearBlocked, dismissToast,
  }
}
