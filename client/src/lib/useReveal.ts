import { useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './motion'

/**
 * Fade an element in the first time it scrolls into view.
 * Content stays fully visible unless animation is possible: with reduced motion, no IntersectionObserver,
 * or before the layout effect runs, no class is added at all.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [state, setState] = useState<'plain' | 'hidden' | 'shown'>('plain')

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return
    setState('hidden')
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('shown')
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const className = state === 'hidden' ? 'reveal' : state === 'shown' ? 'reveal in' : ''
  return { ref, className }
}
