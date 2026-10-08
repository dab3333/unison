import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { RoomPreview } from '../components/RoomPreview'
import { useReveal } from '../lib/useReveal'

/** Stagger index for the entrance animation (see `.rise` in styles.css). */
const step = (i: number) => ({ '--i': i }) as CSSProperties

export default function Landing() {
  const features = useReveal<HTMLElement>()
  return (
    <div className="wrap">
      <nav className="nav">
        <Brand />
        <Link className="btn" to="/signin">Sign in</Link>
      </nav>
      <header className="hero">
        <h1 className="rise" style={step(0)}>Press play,<br /><span className="accent">together.</span></h1>
        <p className="rise" style={step(1)}>Free watch parties with live chat. Everyone plays their own copy, Unison keeps it in perfect sync. No downloads, no lag.</p>
        <div className="cta rise" style={step(2)}>
          <Link className="btn primary" to="/signin">Create a room</Link>
        </div>
        <RoomPreview className="rise" style={step(3)} />
      </header>
      <section ref={features.ref} className={`features ${features.className}`.trim()} id="how">
        <div className="card"><b>1. Make a room</b><span className="muted">Sign in and get a shareable link in one tap.</span></div>
        <div className="card"><b>2. Pick a video</b><span className="muted">A YouTube link or a file on your device. Nothing is uploaded.</span></div>
        <div className="card"><b>3. Watch and chat</b><span className="muted">Friends join with just a nickname. Play, pause and seek stay in sync.</span></div>
      </section>
      <footer>Unison is free. Only share content you have the rights to. &middot; <Link to="/terms">Terms</Link></footer>
    </div>
  )
}
