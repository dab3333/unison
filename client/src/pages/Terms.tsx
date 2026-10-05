import { Brand } from '../components/Brand'

export default function Terms() {
  return (
    <div className="wrap">
      <nav className="nav"><Brand /></nav>
      <main style={{ maxWidth: 680, padding: '16px 0 60px' }} className="stack">
        <h1 style={{ fontSize: '2rem' }}>Terms of use</h1>
        <p className="muted">Unison is a free service provided as is. By using it you agree to the following.</p>
        <h3>Your content</h3>
        <p>Unison does not host or relay video. Each person plays their own copy. Only share links and files you have the right to watch together. Rooms that share content without permission may be removed.</p>
        <h3>Conduct</h3>
        <p>No harassment, hate, spam, or illegal content in rooms or chat. Hosts can remove and ban people from their rooms, and we may close rooms or block users that break these rules.</p>
        <h3>Privacy</h3>
        <p>We store your account profile, your rooms, bans and abuse reports. We do not store chat contents or raw IP addresses; IP addresses are hashed with a daily-rotating salt to limit abuse.</p>
        <h3>Takedown and contact</h3>
        <p>To report content, use the Report button in a room. To request a takedown, open an issue at <a href="https://github.com/dab3333/unison/issues">github.com/dab3333/unison/issues</a> with the room link and what should be removed. Issues are public, so do not include private details.</p>
      </main>
    </div>
  )
}
