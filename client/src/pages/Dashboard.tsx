import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { api, messageFor, type MyRoom } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getAccessToken } from '../lib/identity'

export default function Dashboard() {
  const { user, loading, signOut } = useAuth()
  const nav = useNavigate()
  const [rooms, setRooms] = useState<MyRoom[]>([])
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [allowGuests, setAllowGuests] = useState(true)
  const [everyone, setEveryone] = useState(false)
  const [cap, setCap] = useState(15)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const t = await getAccessToken()
    if (t) setRooms(await api.listRooms(t))
  }, [])

  useEffect(() => {
    if (loading) return
    if (!user) nav('/signin', { replace: true })
    else refresh().catch(() => setListError('Could not load your rooms.'))
  }, [loading, user, nav, refresh])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('not signed in')
      const r = await api.createRoom(t, {
        name: name.trim() || 'Movie night',
        password: password || undefined,
        settings: { allowGuests, controlMode: everyone ? 'everyone' : 'host', maxViewers: cap },
      })
      nav(`/r/${r.slug}`)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }
  async function close(id: string) {
    setListError(null)
    try {
      const t = await getAccessToken()
      if (!t) return
      await api.closeRoom(t, id)
      await refresh()
    } catch {
      setListError('Could not close the room. Please try again.')
    }
  }
  async function copy(slug: string) {
    const url = `${window.location.origin}/r/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      setShareUrl(null)
      setCopied(slug)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setShareUrl(url) // clipboard denied or unavailable: show the link so it can be copied by hand
    }
  }

  return (
    <div className="wrap">
      <nav className="nav">
        <Brand />
        <button className="btn ghost" onClick={() => void signOut()}>Sign out</button>
      </nav>
      <main style={{ padding: '16px 0 40px' }}>
        <h2>My rooms</h2>
        <p className="muted">3 open rooms max. Empty rooms reset after 10 minutes; your link keeps working.</p>

        <form className="card" style={{ marginTop: 20 }} onSubmit={create}>
          <h3>New room</h3>
          <label htmlFor="rname">Room name</label>
          <input id="rname" placeholder="Friday movie night" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="rpw">Password (optional)</label>
          <input id="rpw" type="password" maxLength={64} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="toggle" style={{ marginTop: 8 }}><span>Allow guests</span><input type="checkbox" checked={allowGuests} onChange={(e) => setAllowGuests(e.target.checked)} aria-label="Allow guests" /></div>
          <div className="toggle"><span>Everyone can control playback</span><input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} aria-label="Everyone can control playback" /></div>
          <label htmlFor="cap">Max viewers</label>
          <select id="cap" value={cap} onChange={(e) => setCap(Number(e.target.value))}>
            <option value={5}>5</option><option value={15}>15</option><option value={30}>30</option>
          </select>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Only share content you have the rights to watch together. See the <Link to="/terms">terms</Link>.
          </p>
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy}>Create room</button>
          {error && <p className="err" role="alert">{error}</p>}
        </form>

        {listError && <p className="err" role="alert">{listError}</p>}
        {shareUrl && (
          <div className="notice" role="status" style={{ marginTop: 12 }}>
            Could not copy automatically. Share this link: <b style={{ wordBreak: 'break-all', userSelect: 'all' }}>{shareUrl}</b>
            <button className="btn ghost" onClick={() => setShareUrl(null)}>Dismiss</button>
          </div>
        )}

        <div className="rooms">
          {rooms.map((r) => (
            <div className="card" key={r.id}>
              <div className="room-row">
                <div className="meta">
                  <h3>{r.name}</h3>
                  <span className="muted" style={{ fontSize: 14 }}>{window.location.host}/r/{r.slug}</span>
                </div>
                <span className={r.live > 0 ? 'pill live' : 'pill'}>{r.live > 0 ? `${r.live} watching` : 'Empty'}</span>
              </div>
              <div className="row-actions">
                <Link className="btn primary" to={`/r/${r.slug}`}>Open</Link>
                <button className="btn" onClick={() => void copy(r.slug)}>{copied === r.slug ? 'Copied' : 'Copy link'}</button>
                <button className="btn danger" onClick={() => void close(r.id)}>Close</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
