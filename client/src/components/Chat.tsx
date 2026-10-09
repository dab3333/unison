import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { colorFor } from '../lib/colors'
import { chatComposer } from '../room/permissions'
import { formatClock, groupRows, type TimelineItem } from '../room/chatTimeline'

interface Props {
  items: TimelineItem[]
  enabled: boolean
  muted?: boolean
  canModerate: boolean
  open: boolean
  onSend(text: string): void
  onDelete(id: string): void
}

const NEAR_BOTTOM_PX = 80
const MAX_LEN = 500

export function Chat({ items, enabled, muted = false, canModerate, open, onSend, onDelete }: Props) {
  const [text, setText] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ right: number; top?: number; bottom?: number }>({ right: 0 })
  const [away, setAway] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const composer = chatComposer(enabled, muted)
  const rows = useMemo(() => groupRows(items), [items])
  const lastId = items.at(-1)?.id

  // Follow new items only while the reader is at the bottom; otherwise offer a jump pill instead of yanking the scroll.
  // Keyed on the newest id, not the count: the list is capped, so the count stops changing.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (stickRef.current) el.scrollTop = el.scrollHeight
    else setAway(true)
  }, [lastId])

  // The list scrolls and clips, so the menu is fixed to the viewport, right-aligned to its button, and flips up near the bottom.
  function openMenu(id: string, btn: HTMLElement) {
    if (menuId === id) return setMenuId(null)
    const r = btn.getBoundingClientRect()
    const right = window.innerWidth - r.right
    setMenuPos(r.bottom + 70 > window.innerHeight ? { right, bottom: window.innerHeight - r.top + 4 } : { right, top: r.bottom + 4 })
    setMenuId(id)
  }

  function onScroll() {
    const el = listRef.current
    if (!el) return
    setMenuId(null)
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    stickRef.current = atBottom
    if (atBottom) setAway(false)
  }

  function jump() {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
    stickRef.current = true
    setAway(false)
  }

  // Close the ⋯ menu on Escape or a press anywhere outside it.
  useEffect(() => {
    if (!menuId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuId(null) }
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.msg-menu-wrap')) setMenuId(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [menuId])

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
    stickRef.current = true
  }

  const nearLimit = text.length >= MAX_LEN - 60

  return (
    <section className={open ? 'chat open' : 'chat'} aria-label="Chat">
      <div className="msgs-wrap">
        <div className="msgs" ref={listRef} onScroll={onScroll} role="log" aria-live="polite">
          {items.length === 0 && <p className="chat-empty">No messages yet. Say hello.</p>}
          {rows.map(({ item, showHeader }) => {
            if (item.kind === 'event') {
              return <div className="chat-event" key={item.id}>{item.text}</div>
            }
            return (
              <div className={`row${showHeader ? ' first' : ''}${item.removed ? ' gone' : ''}`} key={item.id}>
                {showHeader && (
                  <div className="row-head">
                    {/* React escapes text; never use dangerouslySetInnerHTML for chat. */}
                    <b style={{ color: colorFor(item.from) }}>{item.nickname}</b>
                    <time>{formatClock(item.at)}</time>
                  </div>
                )}
                <div className="row-body">
                  {item.removed ? (
                    <span className="removed-note">Message removed by a moderator</span>
                  ) : (
                    <span className="row-text">{item.text}</span>
                  )}
                  {canModerate && !item.removed && (
                    <span className="msg-menu-wrap">
                      <button
                        className="msg-more" aria-label={`Actions for ${item.nickname}`}
                        aria-haspopup="menu" aria-expanded={menuId === item.id}
                        onClick={(e) => openMenu(item.id, e.currentTarget)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                        </svg>
                      </button>
                      {menuId === item.id && (
                        <div className="msg-menu" role="menu" style={menuPos}>
                          <button
                            className="menu-item danger" role="menuitem" autoFocus
                            onClick={() => { setMenuId(null); onDelete(item.id) }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {away && <button className="jump" onClick={jump}>New messages</button>}
      </div>
      {muted && <div className="chat-banner" role="status">You're muted. A moderator limited your chat.</div>}
      <form className="composer" onSubmit={submit}>
        <div className="composer-field">
          <input
            aria-label="Message" placeholder={composer.placeholder} maxLength={MAX_LEN}
            autoComplete="off" enterKeyHint="send" disabled={composer.disabled} value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {nearLimit && <span className="count">{MAX_LEN - text.length}</span>}
        </div>
        <button className="btn primary" disabled={composer.disabled || !text.trim()}>Send</button>
      </form>
    </section>
  )
}
