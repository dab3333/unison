export interface AutoHide {
  readonly visible: boolean
  /** Pointer or touch activity: show the controls and restart the idle countdown. */
  activity(): void
  /** While pinned (e.g. paused) the controls stay visible and no countdown runs. */
  setPinned(pinned: boolean): void
  dispose(): void
}

export interface AutoHideOptions {
  delayMs: number
  onChange(visible: boolean): void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** Idle-timer state machine for player controls. Starts visible; hides after `delayMs` without activity. */
export function createAutoHide(o: AutoHideOptions): AutoHide {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let visible = true
  let pinned = false
  let disposed = false
  let handle: unknown

  const set = (v: boolean) => {
    if (v === visible) return
    visible = v
    o.onChange(v)
  }
  const stop = () => {
    if (handle === undefined) return
    clearTimer(handle)
    handle = undefined
  }
  const start = () => {
    stop()
    if (pinned || disposed) return
    handle = setTimer(() => {
      handle = undefined
      set(false)
    }, o.delayMs)
  }

  start()
  return {
    get visible() {
      return visible
    },
    activity() {
      if (disposed) return
      set(true)
      start()
    },
    setPinned(p) {
      if (disposed) return
      pinned = p
      set(true)
      start()
    },
    dispose() {
      disposed = true
      stop()
    },
  }
}
