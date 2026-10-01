const COLORS = ['var(--violet)', 'var(--coral)', 'var(--amber)', 'var(--ok)']

/** Stable per-person color from an id. */
export function colorFor(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]!
}
