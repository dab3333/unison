import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ClientMessage, ErrorCode, Member, PublicSettings, Role, RoomState, Source } from '@unison/shared'
import { WS_URL } from '../lib/config'
import { getIdentity } from '../lib/identity'
import { RoomSocket, type SocketStatus } from '../net/roomSocket'
import { SyncClient } from '../sync/syncClient'

export interface RoomView {
  status: SocketStatus
  closeCode: number | null
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
  clearBlocked(): void
  dismissToast(): void
}

function errorText(code: ErrorCode): string | null {
  switch (code) {
    case 'forbidden': return 'You do not have permission to do that.'
    case 'rate_limited': return 'Slow down a little.'
    case 'bad_request': return 'That did not work.'
    case 'stale': return null // the SyncClient silently snaps back
    default: return null
  }
}

export function useRoom(slug: string): RoomView {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const [closeCode, setCloseCode] = useState<number | null>(null)
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

  if (!syncRef.current) {
    syncRef.current = new SyncClient({
      send: (m) => socketRef.current?.send(m),
      now: Date.now,
      onSource: setSource,
      onBlocked: () => setBlocked(true),
      onMismatch: setMismatch,
      onState: setState,
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
        if (s === 'connecting') setCloseCode(null)
        if (info) setCloseCode(info.code)
      },
      onMessage: (m) => {
        sync.handleServer(m)
        switch (m.type) {
          case 'welcome':
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
          case 'members':
            setMembers(m.members)
            setMe((prev) => {
              const mine = prev && m.members.find((x) => x.id === prev.id)
              return prev && mine && mine.role !== prev.role ? { ...prev, role: mine.role } : prev
            })
            break
          case 'settings':
            setSettings(m.settings)
            break
          case 'error': {
            const text = errorText(m.code)
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

  const send = useCallback((m: ClientMessage) => socketRef.current?.send(m), [])
  const clearBlocked = useCallback(() => setBlocked(false), [])
  const dismissToast = useCallback(() => setToast(null), [])

  return { status, closeCode, me, state, settings, members, chat, source, blocked, mismatch, toast, sync, send, clearBlocked, dismissToast }
}
