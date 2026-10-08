import { useEffect, useRef, useState } from 'react'
import type { AuthUser } from '../lib/auth'
import { colorFor } from '../lib/colors'
import { userInitial } from '../lib/userInitial'

/** Round avatar button that opens a small account menu (name, email, Sign out). */
export function UserMenu({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    itemRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        className="user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" style={{ background: colorFor(user.id) }} aria-hidden="true">{userInitial(user.name)}</span>
        <span className="user-name">{user.name}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <b>{user.name}</b>
            {user.email && <span className="muted">{user.email}</span>}
          </div>
          <button ref={itemRef} className="menu-item" role="menuitem" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  )
}
