import type { Role } from '@unison/shared'

export type Action = 'control' | 'chat' | 'kick' | 'mute' | 'ban' | 'promote' | 'settings' | 'deleteMessage'

const RANK: Record<Role, number> = { guest: 0, member: 0, moderator: 1, host: 2 }

export function can(role: Role, action: Action, s: { controlMode: 'host' | 'everyone' }): boolean {
  switch (action) {
    case 'chat':
      return true
    case 'control':
      return role === 'host' || s.controlMode === 'everyone'
    case 'kick':
    case 'mute':
    case 'deleteMessage':
      return role === 'host' || role === 'moderator'
    case 'ban':
    case 'promote':
    case 'settings':
      return role === 'host'
  }
}

export function canTarget(actor: Role, target: Role): boolean {
  return RANK[actor] > RANK[target]
}
