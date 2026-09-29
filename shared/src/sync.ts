import type { RoomState } from './protocol'

export function derivePosition(
  state: Pick<RoomState, 'isPlaying' | 'position' | 'updatedAt'>,
  serverNow: number,
): number {
  if (!state.isPlaying) return state.position
  return state.position + Math.max(0, serverNow - state.updatedAt) / 1000
}

export type DriftAction = { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek'; to: number }

export function decideDrift(localPos: number, expectedPos: number): DriftAction {
  const drift = localPos - expectedPos
  const abs = Math.abs(drift)
  if (abs < 0.3) return { kind: 'none' }
  if (abs > 2) return { kind: 'seek', to: expectedPos }
  return { kind: 'rate', rate: drift > 0 ? 0.95 : 1.05 }
}

export interface ClockSample {
  t0: number
  t1: number
  serverTime: number
}

/** Returns offset such that serverNow = clientNow + offset. */
export function pickClockOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0
  const best = samples.reduce((a, b) => (b.t1 - b.t0 < a.t1 - a.t0 ? b : a))
  return best.serverTime - (best.t0 + (best.t1 - best.t0) / 2)
}
