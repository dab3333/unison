import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { getAccessToken } from '../lib/identity'

export function ReportDialog({ slug, onClose }: { slug: string; onClose(): void }) {
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setState('sending')
    try {
      await api.report(slug, reason.trim(), await getAccessToken())
      setState('sent')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Report this room">
      <form className="card" onSubmit={submit}>
        <h3>Report this room</h3>
        {state === 'sent' ? (
          <>
            <p className="notice" style={{ marginTop: 12 }}>Thanks. We will review it.</p>
            <button type="button" className="btn primary block" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <label htmlFor="reason">What is wrong?</label>
            <input id="reason" maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Copyright, harassment, spam..." />
            {state === 'error' && <p className="err" role="alert">Could not send. Try again in a minute.</p>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn primary" disabled={state === 'sending'}>Send report</button>
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
