import type { PublicSettings, RoomSettings } from '@unison/shared'

interface Props {
  settings: PublicSettings
  onChange(patch: Partial<RoomSettings>): void
  onClose(): void
}

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Room settings">
      <div className="card">
        <h3>Room settings</h3>
        <div className="toggle" style={{ marginTop: 8 }}>
          <span>Allow guests</span>
          <input type="checkbox" checked={settings.allowGuests} aria-label="Allow guests" onChange={(e) => onChange({ allowGuests: e.target.checked })} />
        </div>
        <div className="toggle">
          <span>Everyone can control playback</span>
          <input type="checkbox" checked={settings.controlMode === 'everyone'} aria-label="Everyone can control playback" onChange={(e) => onChange({ controlMode: e.target.checked ? 'everyone' : 'host' })} />
        </div>
        <div className="toggle">
          <span>Chat on</span>
          <input type="checkbox" checked={settings.chatEnabled} aria-label="Chat on" onChange={(e) => onChange({ chatEnabled: e.target.checked })} />
        </div>
        <div className="toggle">
          <span>Pause for everyone when someone buffers</span>
          <input type="checkbox" checked={settings.pauseOnBuffering} aria-label="Pause when someone buffers" onChange={(e) => onChange({ pauseOnBuffering: e.target.checked })} />
        </div>
        <label htmlFor="cap">Max viewers</label>
        <select id="cap" value={settings.maxViewers} onChange={(e) => onChange({ maxViewers: Number(e.target.value) })}>
          {[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="btn primary block" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
