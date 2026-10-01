import { useState, type FormEvent } from 'react'
import type { Source } from '@unison/shared'
import { parseSourceInput } from '../lib/sourceInput'

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    v.preload = 'metadata'
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration) }
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')) }
    v.src = url
  })
}

export function SourcePicker({ onSource, onFile }: { onSource(s: Source): void; onFile(f: File, source: Source): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const r = parseSourceInput(text)
    if (!r.ok) return setError(r.reason)
    setError(null)
    onSource(r.source)
    setText('')
  }
  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      const duration = await readDuration(f)
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('no duration')
      const source: Source = { type: 'file', name: f.name, size: f.size, duration }
      onFile(f, source)
      onSource(source)
    } catch {
      setError('Could not read that video file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ width: '100%' }}>
      <form onSubmit={submit} className="row" style={{ flexWrap: 'nowrap' }}>
        <label htmlFor="src" className="sr-only">Video link</label>
        <input id="src" placeholder="Paste a YouTube or video link" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button className="btn primary">Load</button>
      </form>
      <div className="divider">or</div>
      <label className="btn block file-btn">
        {busy ? 'Reading file...' : 'Choose a video file'}
        <input type="file" accept="video/*" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  )
}
