import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { useAuth } from '../lib/auth'

export default function SignIn() {
  const { user, signInWith, signInWithEmail } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (user) nav('/dashboard', { replace: true }) }, [user, nav])

  async function onEmail(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await signInWithEmail(email.trim())
      setSent(true)
    } catch {
      setError('Could not send the link. Check the address and try again.')
    }
  }

  return (
    <div className="wrap">
      <nav className="nav"><Brand /></nav>
      <main className="center">
        <div className="card">
          <h2>Sign in to host</h2>
          <p className="muted" style={{ marginTop: 6 }}>You only need an account to create rooms. Friends can join without one.</p>
          <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
            <button className="btn block" onClick={() => void signInWith('google')}>Continue with Google</button>
            <button className="btn block" onClick={() => void signInWith('discord')}>Continue with Discord</button>
          </div>
          <div className="divider">or</div>
          {sent ? (
            <p className="notice">Check your inbox: we sent a sign-in link to {email}.</p>
          ) : (
            <form onSubmit={onEmail}>
              <label htmlFor="email" style={{ marginTop: 0 }}>Email</label>
              <input id="email" type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn primary block" style={{ marginTop: 14 }}>Email me a magic link</button>
            </form>
          )}
          {error && <p className="err" role="alert">{error}</p>}
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>No passwords. By continuing you agree to the <a href="/terms">Terms</a>.</p>
        </div>
      </main>
    </div>
  )
}
