// Landing-page picture of a room: drawn from our own brand shapes instead of a film still.
// Everything here is decorative (aria-hidden) and flat color only.
const MEMBERS = [
  { initial: 'M', color: 'var(--violet)' },
  { initial: 'L', color: 'var(--coral)' },
  { initial: 'P', color: 'var(--amber)' },
]

export function RoomPreview() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="screen">
        <svg className="scene" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" focusable="false">
          <defs>
            <clipPath id="preview-lens"><circle cx="262" cy="160" r="96" /></clipPath>
          </defs>
          <rect width="640" height="360" fill="#150F2E" />
          <circle cx="262" cy="160" r="96" fill="#7C6CFF" />
          <circle cx="378" cy="160" r="96" fill="#FF7A59" />
          <circle cx="378" cy="160" r="96" fill="#FFC857" clipPath="url(#preview-lens)" />
        </svg>
        <span className="pill live sync">In sync</span>
        <div className="bar">
          <svg className="icon" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          <span className="time">12:31 / 1:48:00</span>
          <div className="track">
            <i />
            <div className="heads">
              {MEMBERS.map((m) => (
                <b key={m.initial} style={{ background: m.color }}>{m.initial}</b>
              ))}
            </div>
          </div>
          <span className="together">3 in unison</span>
        </div>
      </div>
      <div className="chatline"><b style={{ color: 'var(--violet)' }}>Maya</b> ok wait for the good part</div>
      <div className="chatline"><b style={{ color: 'var(--coral)' }}>Leo</b> synced! 3 people in unison</div>
    </div>
  )
}
