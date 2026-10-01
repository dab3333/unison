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

/** Mirrors the server: the host always controls playback; everyone else only in 'everyone' mode. */
export function canControlPlayback(role: Role | undefined, controlMode: 'host' | 'everyone' | undefined): boolean {
  return role === 'host' || (role !== undefined && controlMode === 'everyone')
}

/** The chat input's state: a muted member cannot type, and is told why. */
export function chatComposer(enabled: boolean, muted: boolean): { disabled: boolean; placeholder: string } {
  if (muted) return { disabled: true, placeholder: 'You are muted' }
  if (!enabled) return { disabled: true, placeholder: 'Chat is off' }
  return { disabled: false, placeholder: 'Say something' }
}
