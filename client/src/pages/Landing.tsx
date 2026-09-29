import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'

export default function Landing() {
  return (
    <div className="wrap">
      <nav className="nav">
        <Brand />
        <Link className="btn" to="/signin">Sign in</Link>
      </nav>
      <header className="hero">
        <h1>Press play,<br /><span className="accent">together.</span></h1>
        <p>Free watch parties with live chat. Everyone plays their own copy, Unison keeps it in perfect sync. No downloads, no lag.</p>
        <div className="cta">
          <Link className="btn primary" to="/signin">Create a room</Link>
        </div>
        <div className="mock" aria-hidden="true">
          <div className="screen"><span><svg className="icon" viewBox="0 0 24 24" style={{ width: 28, height: 28 }}><path d="M8 5v14l11-7z" /></svg></span></div>
          <div className="chatline"><b style={{ color: 'var(--violet)' }}>Maya</b> ok wait for the good part</div>
          <div className="chatline"><b style={{ color: 'var(--coral)' }}>Leo</b> synced! 3 people in unison</div>
        </div>
      </header>
      <section className="features" id="how">
        <div className="card"><b>1. Make a room</b><span className="muted">Sign in and get a shareable link in one tap.</span></div>
        <div className="card"><b>2. Pick a video</b><span className="muted">A YouTube link or a file on your device. Nothing is uploaded.</span></div>
        <div className="card"><b>3. Watch and chat</b><span className="muted">Friends join with just a nickname. Play, pause and seek stay in sync.</span></div>
      </section>
      <footer>Unison is free. Only share content you have the rights to. &middot; <Link to="/terms">Terms</Link></footer>
    </div>
  )
}
