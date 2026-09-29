import type { Role } from '@unison/shared'

export type ModOp = 'kick' | 'mute' | 'unmute' | 'ban' | 'promote' | 'demote'
const RANK: Record<Role, number> = { guest: 0, member: 0, moderator: 1, host: 2 }

export function availableOps(actor: Role, target: { role: Role; muted: boolean }): ModOp[] {
  if (RANK[actor] <= RANK[target.role]) return []
  const ops: ModOp[] = [target.muted ? 'unmute' : 'mute', 'kick']
  if (actor === 'host') {
    ops.push('ban')
    if (target.role === 'member') ops.push('promote')
    if (target.role === 'moderator') ops.push('demote')
  }
  return ops
}

export function canModerateChat(role: Role | undefined): boolean {
  return role === 'host' || role === 'moderator'
}
