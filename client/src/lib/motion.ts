interface MediaWindow {
  matchMedia?: (query: string) => { matches: boolean }
}

/** True when the user asked the OS/browser for reduced motion. Never throws; defaults to animating. */
export function prefersReducedMotion(win: MediaWindow | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  try {
    return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
