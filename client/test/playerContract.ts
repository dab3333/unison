import { describe, it, expect, vi } from 'vitest'
import type { Player } from '../src/player/Player'

/** Simulates things the *platform* does (user taps native controls, network stalls, autoplay policy). */
export interface PlayerSim {
  userPlay(): void
  userPause(): void
  userSeek(to: number): void
  bufferStart(): void
  bufferEnd(): void
  ready(): void
  blockNextPlay(): void
  setDuration(n: number): void
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export function runPlayerContract(name: string, make: () => { player: Player; sim: PlayerSim }) {
  describe(`${name} satisfies the Player contract`, () => {
    it('emits play once when the platform starts playback, and isPlaying follows', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('play', cb)
      sim.userPlay(); await tick()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(player.isPlaying()).toBe(true)
    })
    it('emits pause and isPlaying follows', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('pause', cb)
      sim.userPlay(); sim.userPause(); await tick()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(player.isPlaying()).toBe(false)
    })
    it('emits seek and reports the new time', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('seek', cb)
      sim.userSeek(30); await tick()
      expect(cb).toHaveBeenCalled()
      expect(player.getTime()).toBe(30)
    })
    it('emits buffering true then false', async () => {
      const { player, sim } = make()
      const seen: unknown[] = []; player.on('buffering', (v) => seen.push(v))
      sim.userPlay(); sim.bufferStart(); sim.bufferEnd(); await tick()
      expect(seen).toEqual([false, true, false]) // playback start reports not-buffering first
    })
    it('emits ready', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('ready', cb)
      sim.ready(); await tick()
      expect(cb).toHaveBeenCalled()
    })
    it('seek(), getTime(), getDuration() and setRate() work', () => {
      const { player, sim } = make()
      sim.setDuration(120)
      player.seek(42)
      expect(player.getTime()).toBe(42)
      expect(player.getDuration()).toBe(120)
      expect(() => player.setRate(1.05)).not.toThrow()
    })
    it('emits blocked when autoplay policy rejects play()', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('blocked', cb)
      sim.blockNextPlay(); player.play(); await tick()
      expect(cb).toHaveBeenCalledTimes(1)
    })
    it('stops emitting after destroy()', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('play', cb); player.on('pause', cb)
      player.destroy()
      sim.userPlay(); sim.userPause(); await tick()
      expect(cb).not.toHaveBeenCalled()
    })
  })
}
