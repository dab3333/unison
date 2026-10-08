import { useEffect, useState, type CSSProperties } from 'react'
import { fmt } from '../lib/format'
import { prefersReducedMotion } from '../lib/motion'

// Landing-page picture of a room, drawn from our own brand shapes instead of a film still.
// Decorative only (aria-hidden), flat color only. Every element's base style is its FINAL state; the
// "unison" sequence (circles drift together, avatars glide onto one playhead, Syncing -> In sync) is a
// one-time CSS animation that reduced-motion users never see.
const MEMBERS = [
  { initial: 'M', color: 'var(--violet)' },
  { initial: 'L', color: 'var(--coral)' },
  { initial: 'P', color: 'var(--amber)' },
]
const START_SECONDS = 12 * 60 + 31
const TOTAL_SECONDS = 108 * 60

/** Ticks once a second after the sequence has settled; stays put for reduced motion and hidden tabs. */
function useTimecode(start: number, beginAfterMs: number): number {
  const [seconds, setSeconds] = useState(start)
  useEffect(() => {
    if (prefersReducedMotion()) return
    let tick: ReturnType<typeof setInterval> | undefined
    const begin = setTimeout(() => {
      tick = setInterval(() => {
        if (!document.hidden) setSeconds((s) => s + 1)
      }, 1000)
    }, beginAfterMs)
    return () => {
      clearTimeout(begin)
      if (tick) clearInterval(tick)
    }
  }, [beginAfterMs])
  return seconds
}

export function RoomPreview({ className = '', style }: { className?: string; style?: CSSProperties }) {
  const seconds = useTimecode(START_SECONDS, 3200)
  return (
    <div className={`mock ${className}`.trim()} style={style} aria-hidden="true">
      <div className="screen">
        <svg className="scene" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" focusable="false">
          <defs>
            <clipPath id="preview-lens"><circle cx="262" cy="160" r="96" /></clipPath>
          </defs>
          <rect width="640" height="360" fill="#150F2E" />
          <circle className="c-violet" cx="262" cy="160" r="96" fill="#7C6CFF" />
          <circle className="c-coral" cx="378" cy="160" r="96" fill="#FF7A59" />
          <circle className="c-lens" cx="378" cy="160" r="96" fill="#FFC857" clipPath="url(#preview-lens)" />
        </svg>
        <span className="pill warn sync sync-a">Syncing…</span>
        <span className="pill live sync sync-b">In sync</span>
        <div className="bar">
          <svg className="icon" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          <span className="time">{fmt(seconds)} / {fmt(TOTAL_SECONDS)}</span>
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
