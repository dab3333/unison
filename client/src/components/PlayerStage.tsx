import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Source } from '@unison/shared'
import { fmt, formatSize } from '../lib/format'
import { HtmlVideoAdapter } from '../player/HtmlVideoAdapter'
import type { Player } from '../player/Player'
import { createYouTubeAdapter } from '../player/YouTubeAdapter'
import type { SyncClient } from '../sync/syncClient'

const PLAY = 'M8 5v14l11-7z'
const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z'
const FULL = 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
const Icon = ({ d }: { d: string }) => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
)

interface Props {
  sync: SyncClient
  source: Source | null
  canControl: boolean
  localFile: File | null
  onPickFile(f: File): void
  blocked: boolean
  onUnblock(): void
  onFullscreen(): void
  overlay?: ReactNode
  extraControls?: ReactNode
}

export function PlayerStage(p: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ytRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<Player | null>(null)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { sync, source, localFile } = p
  const sourceKey = JSON.stringify(source)

  // Build the right Player for the room's source, and hand it to the SyncClient.
  useEffect(() => {
    setLoadError(null)
    if (!source) return
    let cancelled = false
    let player: Player | null = null
    let objectUrl: string | null = null
    let hls: { destroy(): void } | null = null
    const video = videoRef.current
    const attach = (pl: Player) => {
      if (cancelled) return pl.destroy()
      player = pl
      setActive(pl)
      sync.attachPlayer(pl)
    }
    void (async () => {
      try {
        if (source.type === 'youtube') {
          const host = ytRef.current
          if (!host) return
          host.innerHTML = ''
          const el = document.createElement('div')
          host.appendChild(el)
          attach(await createYouTubeAdapter(el, source.id!, p.canControl))
        } else if (source.type === 'file') {
          if (!localFile || !video) return
          objectUrl = URL.createObjectURL(localFile)
          video.src = objectUrl
          attach(new HtmlVideoAdapter(video))
        } else if (source.type === 'url') {
          if (!video) return
          video.src = source.url!
          attach(new HtmlVideoAdapter(video))
        } else if (source.type === 'hls') {
          if (!video) return
          const { default: Hls } = await import('hls.js')
          if (cancelled) return
          if (Hls.isSupported()) {
            const h = new Hls()
            h.loadSource(source.url!)
            h.attachMedia(video)
            hls = h
          } else {
            video.src = source.url! // Safari plays HLS natively
          }
          attach(new HtmlVideoAdapter(video))
        }
      } catch {
        if (cancelled) return
        setLoadError(
          source.type === 'youtube'
            ? 'Could not load this YouTube video (blocked, removed, or embedding is disabled). Ask the host to pick another source.'
            : 'Could not load this video. Ask the host to pick another source.',
        )
      }
    })()
    return () => {
      cancelled = true
      player?.destroy()
      setActive(null)
      hls?.destroy()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (video) {
        video.removeAttribute('src')
        video.load()
      }
    }
    // canControl only affects YouTube's native controls at creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, localFile, sync])

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      setTime(active.getTime())
      const d = active.getDuration()
      setDur(Number.isFinite(d) ? d : 0)
      setPlaying(active.isPlaying())
    }, 250)
    return () => clearInterval(id)
  }, [active])

  function commitScrub() {
    if (scrub !== null && active) {
      active.seek(scrub)
      setScrub(null)
    }
  }

  const isYt = source?.type === 'youtube'
  const needsFile = source?.type === 'file' && !localFile

  return (
    <div className="player">
      {isYt ? <div className="yt" ref={ytRef} /> : <video ref={videoRef} playsInline preload="auto" tabIndex={-1} />}

      {needsFile && source && (
        <div className="overlay">
          <div className="stack" style={{ maxWidth: 360 }}>
            <b>Pick the same file</b>
            <p className="muted">
              The host is playing "{source.name}" ({formatSize(source.size)}). Choose that file from your device. Nothing is uploaded.
            </p>
            <label className="btn primary file-btn">
              Choose file
              <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onPickFile(f) }} />
            </label>
          </div>
        </div>
      )}

      {loadError && (
        <div className="overlay">
          <p className="err" role="alert" style={{ maxWidth: 360 }}>{loadError}</p>
        </div>
      )}

      {p.overlay}

      {p.blocked && !p.overlay && !needsFile && !loadError && (
        <div className="overlay">
          <button className="btn primary" onClick={p.onUnblock}>Tap to join playback</button>
        </div>
      )}

      {source && active && (
        <div className="controls">
          {p.canControl ? (
            <input
              type="range" min={0} max={dur || 1} step={1} value={scrub ?? time} aria-label="Seek"
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={commitScrub} onKeyUp={commitScrub} onTouchEnd={commitScrub}
            />
          ) : (
            <div className="bar"><i style={{ width: dur ? `${Math.min(100, (time / dur) * 100)}%` : '0%' }} /></div>
          )}
          <div className="ctl-row">
            {p.canControl && (
              <button className="ctl-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? active.pause() : active.play())}>
                <Icon d={playing ? PAUSE : PLAY} />
              </button>
            )}
            <span>{fmt(time)} / {fmt(dur)}</span>
            <span style={{ flex: 1 }} />
            {p.extraControls}
            <button className="ctl-btn" aria-label="Fullscreen" onClick={p.onFullscreen}><Icon d={FULL} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
