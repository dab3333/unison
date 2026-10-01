import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { api, messageFor, type RoomInfo } from '../lib/api'
import { useAuth } from '../lib/auth'
import { reusableGuestToken } from '../lib/guestToken'
import { loadGuest, saveGuest } from '../lib/identity'

export default function Join() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const carried = (location.state as { nickname?: string } | null)?.nickname // from a room whose guest token expired
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [nick, setNick] = useState(carried ?? loadGuest()?.nickname ?? '')
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.roomInfo(slug).then(setInfo).catch(() => setMissing(true))
  }, [slug])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (!user) {
        const name = nick.trim()
        const token = reusableGuestToken(loadGuest(), name, Date.now()) ?? (await api.createGuest(name)).token
        saveGuest({ token, nickname: name })
      }
      try {
        if (pw) sessionStorage.setItem(`unison.pw.${slug}`, pw)
      } catch { /* private mode */ }
      nav(`/r/${slug}`)
    } catch (err) {
      setError(messageFor(err))
    }
  }

  return (
    <div className="wrap">
      <nav className="nav"><Brand /></nav>
      <main className="center">
        <div className="card">
          {missing ? (
            <>
              <h2>Room not found</h2>
              <p className="muted" style={{ marginTop: 6 }}>This room does not exist or was closed by its host.</p>
            </>
          ) : !info ? (
            <p className="muted">Loading room...</p>
          ) : (
            <>
              <span className={info.live > 0 ? 'pill live' : 'pill'}>{info.live > 0 ? `Live · ${info.live} watching` : 'Waiting for people'}</span>
              <h2 style={{ marginTop: 10 }}>{info.name}</h2>
              <p className="muted" style={{ marginTop: 4 }}>Hosted by {info.ownerName}</p>
              {!info.settings.allowGuests && !user ? (
                <p className="notice" style={{ marginTop: 16 }}>This room is for signed-in members only. <a href="/signin">Sign in</a> to join.</p>
              ) : (
                <form onSubmit={submit}>
                  {!user && (
                    <>
                      <label htmlFor="nick">Pick a nickname</label>
                      <input id="nick" maxLength={24} placeholder="e.g. PopcornPat" autoComplete="nickname" required value={nick} onChange={(e) => setNick(e.target.value)} />
                    </>
                  )}
                  {info.settings.hasPassword && (
                    <>
                      <label htmlFor="pw">Room password</label>
                      <input id="pw" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} />
                    </>
                  )}
                  <button className="btn primary block" style={{ marginTop: 16 }}>Join room</button>
                  {error && <p className="err" role="alert">{error}</p>}
                </form>
              )}
              <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>No account needed. <a href="/signin">Sign in</a> to host your own.</p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
