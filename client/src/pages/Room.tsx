import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import type { Source } from '@unison/shared'
import { Chat } from '../components/Chat'
import { Members } from '../components/Members'
import { PlayerStage } from '../components/PlayerStage'
import { SourcePicker } from '../components/SourcePicker'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { getIdentity } from '../lib/identity'
import { useRoom } from '../room/useRoom'

const CLOSED_TEXT: Record<number, string> = {
  4002: 'Your session expired. Join again to continue.',
  4003: 'You were removed from this room.',
  4004: 'You are banned from this room.',
  4005: 'This room was closed.',
  4006: 'Could not join: the room is full, guests are off, the password was wrong, or it no longer exists.',
  4008: 'You were disconnected for sending too many messages.',
}

export default function Room() {
  const { slug = '' } = useParams()
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null)
  useEffect(() => { void getIdentity().then((i) => setHasIdentity(!!i)) }, [])
  if (hasIdentity === null) return null
  if (!hasIdentity) return <Navigate to={`/join/${slug}`} replace />
  return <RoomView slug={slug} />
}

function RoomView({ slug }: { slug: string }) {
  const room = useRoom(slug)
  const [name, setName] = useState('Room')
  const [sheet, setSheet] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [offset, setOffset] = useState(0)
  const [copied, setCopied] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => { api.roomInfo(slug).then((i) => setName(i.name)).catch(() => {}) }, [slug])
  useEffect(() => {
    if (!room.toast) return
    const t = setTimeout(room.dismissToast, 3500)
    return () => clearTimeout(t)
  }, [room.toast, room.dismissToast])

  // A 'closed' status without a code is an intentional close (e.g. StrictMode cleanup), not terminal.
  if (room.status === 'closed' && room.closeCode !== null) {
    return (
      <div className="wrap">
        <main className="center">
          <div className="card">
            <h2>Left the room</h2>
            <p className="muted" style={{ marginTop: 6 }}>{CLOSED_TEXT[room.closeCode] ?? 'The connection was closed.'}</p>
            <Link className="btn primary block" style={{ marginTop: 16 }} to="/">Back to Unison</Link>
          </div>
        </main>
      </div>
    )
  }

  const role = room.me?.role
  const canControl = role === 'host' || room.settings?.controlMode === 'everyone'
  const chatEnabled = room.settings?.chatEnabled !== false || role === 'host'

  function setSource(source: Source) {
    room.send({ type: 'control', version: room.state?.version ?? 0, action: 'setSource', source })
    setPicking(false)
  }
  async function invite() {
    await navigator.clipboard.writeText(`${window.location.origin}/r/${slug}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  let overlay: ReactNode
  if (!room.me) {
    overlay = <div className="overlay"><p className="muted">Connecting...</p></div>
  } else if (!room.source || picking) {
    overlay = canControl ? (
      <div className="overlay">
        <div className="stack" style={{ width: '100%', maxWidth: 420 }}>
          <h3>Pick something to watch</h3>
          <SourcePicker onSource={setSource} onFile={setLocalFile} />
          {room.source && <button className="link-like" onClick={() => setPicking(false)}>Cancel</button>}
        </div>
      </div>
    ) : (
      <div className="overlay"><p className="muted">Waiting for the host to pick a video...</p></div>
    )
  }

  return (
    <div className="room">
      <header className="room-top">
        <Link to="/" aria-label="Unison home"><img src="/logo-mark.svg" alt="" style={{ height: 38, display: 'block' }} /></Link>
        <strong style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</strong>
        <button className="btn hide-desktop" aria-controls="sheet" onClick={() => setSheet(true)}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a3 3 0 100-6 3 3 0 000 6zM8 11a3 3 0 100-6 3 3 0 000 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-.9.1 1.2.8 1.9 1.9 1.9 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z" /></svg>
          {room.members.length}
        </button>
        {canControl && room.source && <button className="btn" onClick={() => setPicking(true)}>Change video</button>}
        <button className="btn" onClick={() => void invite()}>{copied ? 'Copied' : 'Invite'}</button>
      </header>

      <div className="stage" ref={stageRef}>
        <div className="video-col">
          <PlayerStage
            sync={room.sync}
            source={room.source}
            canControl={canControl}
            localFile={localFile}
            onPickFile={setLocalFile}
            blocked={room.blocked}
            onUnblock={() => { room.clearBlocked(); room.sync.reconcile() }}
            onFullscreen={() => void stageRef.current?.requestFullscreen?.().catch(() => {})}
            overlay={overlay}
            extraControls={
              <button className="ctl-btn show-landscape" aria-label="Toggle chat" onClick={() => setChatOpen((o) => !o)}>Chat</button>
            }
          />

          {room.mismatch && (
            <div className="notice" style={{ margin: 12 }}>
              <b>Your file may be a different version.</b> Host: {fmt(room.mismatch.expected)}, yours: {fmt(room.mismatch.actual)}.
              If the picture is offset, nudge it until it lines up.
              <label htmlFor="offset">Offset: {offset.toFixed(1)}s</label>
              <input
                id="offset" type="range" min={-30} max={30} step={0.5} value={offset}
                onChange={(e) => { const v = Number(e.target.value); setOffset(v); room.sync.setUserOffset(v) }}
              />
            </div>
          )}

          <aside className={sheet ? 'sheet open' : 'sheet'} id="sheet" aria-label="Members">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>In this room</h3>
              <button className="btn ghost hide-desktop" onClick={() => setSheet(false)}>Done</button>
            </div>
            <Members members={room.members} meId={room.me?.id} />
          </aside>
        </div>

        <Chat
          messages={room.chat}
          enabled={chatEnabled}
          canModerate={false}
          open={chatOpen}
          onSend={(text) => room.send({ type: 'chat', text })}
          onDelete={() => {}}
        />
      </div>

      {room.status === 'reconnecting' && <div className="toast" role="status">Reconnecting...</div>}
      {room.toast && <div className="toast" role="status">{room.toast}</div>}
    </div>
  )
}
