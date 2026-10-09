import type { ChatMessage, Member } from '@unison/shared'

export type TimelineItem =
  | { kind: 'message'; id: string; from: string; nickname: string; text: string; at: number; removed: boolean }
  | { kind: 'event'; id: string; text: string; at: number }

export interface Row {
  item: TimelineItem
  /** True when this row starts a new run: show the sender's name and time above it. */
  showHeader: boolean
}

/** A run from one sender continues while messages are less than this far apart. */
const RUN_GAP_MS = 5 * 60_000

export function fromHistory(chat: ChatMessage[]): TimelineItem[] {
  return chat.map((m) => ({
    kind: 'message', id: m.id, from: m.from, nickname: m.nickname, text: m.text, at: m.at, removed: false,
  }))
}

export function append(items: TimelineItem[], item: TimelineItem, cap: number): TimelineItem[] {
  return [...items, item].slice(-cap)
}

/** A moderator removal keeps the row (so people see something was removed) but drops the text. */
export function markRemoved(items: TimelineItem[], id: string): TimelineItem[] {
  return items.map((i) => (i.kind === 'message' && i.id === id ? { ...i, removed: true, text: '' } : i))
}

/** Plain-text event lines for who came, went, or changed standing between two member lists. */
export function memberEvents(
  prev: Member[] | null, next: Member[], meId: string | undefined, at: number, nextId: () => string,
): TimelineItem[] {
  if (!prev) return []
  const out: TimelineItem[] = []
  const say = (text: string) => out.push({ kind: 'event', id: nextId(), text, at })
  const before = new Map(prev.map((m) => [m.id, m]))
  const after = new Map(next.map((m) => [m.id, m]))
  for (const m of next) {
    const old = before.get(m.id)
    if (!old) {
      if (m.id !== meId) say(`${m.nickname} joined`)
      continue
    }
    if (!old.muted && m.muted) say(`${m.nickname} was muted`)
    else if (old.muted && !m.muted) say(`${m.nickname} was unmuted`)
    if (old.role !== 'moderator' && m.role === 'moderator') say(`${m.nickname} is now a moderator`)
    else if (old.role === 'moderator' && m.role !== 'moderator') say(`${m.nickname} is no longer a moderator`)
  }
  for (const m of prev) if (!after.has(m.id)) say(`${m.nickname} left`)
  return out
}

export function groupRows(items: TimelineItem[]): Row[] {
  let prev: TimelineItem | undefined
  return items.map((item) => {
    const continues =
      prev?.kind === 'message' && item.kind === 'message' && prev.from === item.from && item.at - prev.at < RUN_GAP_MS
    prev = item
    return { item, showHeader: item.kind === 'message' && !continues }
  })
}

export function formatClock(at: number, opts: { locale?: string; timeZone?: string } = {}): string {
  if (!Number.isFinite(at)) return ''
  try {
    return new Intl.DateTimeFormat(opts.locale, {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: opts.timeZone,
    }).format(at)
  } catch {
    return ''
  }
}
