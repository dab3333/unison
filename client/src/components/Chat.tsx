import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatMessage } from '@unison/shared'
import { colorFor } from '../lib/colors'

interface Props {
  messages: ChatMessage[]
  enabled: boolean
  canModerate: boolean
  open: boolean
  onSend(text: string): void
  onDelete(id: string): void
}

export function Chat({ messages, enabled, canModerate, open, onSend, onDelete }: Props) {
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  return (
    <section className={open ? 'chat open' : 'chat'} aria-label="Chat">
      <div className="msgs" aria-live="polite">
        {messages.map((m) => (
          <div className="msg" key={m.id}>
            {/* React escapes text; never use dangerouslySetInnerHTML for chat. */}
            <b style={{ color: colorFor(m.from) }}>{m.nickname}</b>
            {m.text}
            {canModerate && (
              <button className="btn ghost msg-del" aria-label={`Delete message from ${m.nickname}`} onClick={() => onDelete(m.id)}>Delete</button>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={submit}>
        <input
          aria-label="Message" placeholder={enabled ? 'Say something' : 'Chat is off'} maxLength={500}
          autoComplete="off" enterKeyHint="send" disabled={!enabled} value={text} onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" disabled={!enabled}>Send</button>
      </form>
    </section>
  )
}
