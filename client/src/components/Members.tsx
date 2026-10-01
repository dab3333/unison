import type { ReactNode } from 'react'
import type { Member } from '@unison/shared'
import { colorFor } from '../lib/colors'

interface Props {
  members: Member[]
  meId: string | undefined
  actions?: (m: Member) => ReactNode
}

export function Members({ members, meId, actions }: Props) {
  return (
    <>
      {members.map((m) => (
        <div className="member" key={m.id}>
          <span className="who">
            <span className="avatar" style={{ background: colorFor(m.id) }} aria-hidden="true">
              {(Array.from(m.nickname)[0] ?? '?').toUpperCase()}
            </span>
            {m.nickname}{m.id === meId ? ' (you)' : ''}
            {m.role === 'host' && <span className="pill host" style={{ marginLeft: 8 }}>Host</span>}
            {m.role === 'moderator' && <span className="pill host" style={{ marginLeft: 8 }}>Mod</span>}
            {m.role === 'guest' && <span className="pill" style={{ marginLeft: 8 }}>Guest</span>}
            {m.muted && <span className="pill" style={{ marginLeft: 8 }}>Muted</span>}
          </span>
          <span className="row">{m.id !== meId && actions?.(m)}</span>
        </div>
      ))}
    </>
  )
}
