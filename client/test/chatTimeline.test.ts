import { describe, it, expect } from 'vitest'
import type { Member } from '@unison/shared'
import {
  append, formatClock, fromHistory, groupRows, markRemoved, memberEvents, type TimelineItem,
} from '../src/room/chatTimeline'

const msg = (id: string, from: string, at: number, text = id, removed = false): TimelineItem => ({
  kind: 'message', id, from, nickname: from.toUpperCase(), text, at, removed,
})
const evt = (id: string, at: number): TimelineItem => ({ kind: 'event', id, text: id, at })
const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, nickname: id.toUpperCase(), role: 'member', muted: false, buffering: false, ...over,
})
let n = 0
const nextId = () => `e${++n}`

describe('fromHistory', () => {
  it('turns server chat messages into timeline messages that are not removed', () => {
    expect(fromHistory([{ id: 'a', from: 'u1', nickname: 'Maya', text: 'hi', at: 5 }])).toEqual([
      { kind: 'message', id: 'a', from: 'u1', nickname: 'Maya', text: 'hi', at: 5, removed: false },
    ])
  })
})

describe('append', () => {
  it('adds an item and keeps only the newest ones up to the cap', () => {
    const items = [msg('1', 'a', 1), msg('2', 'a', 2), msg('3', 'a', 3)]
    expect(append(items, msg('4', 'a', 4), 3).map((i) => i.id)).toEqual(['2', '3', '4'])
  })
})

describe('markRemoved', () => {
  it('keeps the slot but drops the text, so the removal is visible', () => {
    const out = markRemoved([msg('1', 'a', 1, 'secret'), msg('2', 'a', 2)], '1')
    expect(out[0]).toMatchObject({ id: '1', removed: true, text: '' })
    expect(out[1]).toMatchObject({ id: '2', removed: false })
  })
  it('ignores unknown ids', () => {
    const items = [msg('1', 'a', 1)]
    expect(markRemoved(items, 'zzz')).toEqual(items)
  })
})

describe('memberEvents', () => {
  it('says nothing about the first member list (everyone already here)', () => {
    expect(memberEvents(null, [member('a'), member('b')], 'a', 10, nextId)).toEqual([])
  })
  it('announces other people joining and leaving, but not yourself', () => {
    const prev = [member('a')]
    const next = [member('a'), member('b'), member('me')]
    expect(memberEvents(prev, next, 'me', 10, nextId).map((e) => e.kind === 'event' && e.text)).toEqual(['B joined'])
    expect(memberEvents(next, prev, 'a', 11, nextId).map((e) => e.kind === 'event' && e.text)).toEqual(['B left', 'ME left'])
  })
  it('announces mutes, unmutes and moderator changes', () => {
    const text = (prev: Member[], next: Member[]) => memberEvents(prev, next, 'zz', 1, nextId).map((e) => e.kind === 'event' && e.text)
    expect(text([member('p')], [member('p', { muted: true })])).toEqual(['P was muted'])
    expect(text([member('p', { muted: true })], [member('p')])).toEqual(['P was unmuted'])
    expect(text([member('l')], [member('l', { role: 'moderator' })])).toEqual(['L is now a moderator'])
    expect(text([member('l', { role: 'moderator' })], [member('l')])).toEqual(['L is no longer a moderator'])
  })
  it('is silent when nothing changed, and ignores buffering flips', () => {
    const a = [member('a'), member('b')]
    expect(memberEvents(a, a, 'a', 1, nextId)).toEqual([])
    expect(memberEvents(a, [member('a'), member('b', { buffering: true })], 'a', 1, nextId)).toEqual([])
  })
  it('stamps events with the given time and unique ids, as event items', () => {
    const out = memberEvents([member('a')], [member('a'), member('b'), member('c')], 'a', 99, nextId)
    expect(out.every((e) => e.kind === 'event' && e.at === 99)).toBe(true)
    expect(new Set(out.map((e) => e.id)).size).toBe(2)
  })
  it('keeps nicknames as plain text (no markup interpretation here)', () => {
    const out = memberEvents([member('a')], [member('a'), member('x', { nickname: '<b>hi</b>' })], 'a', 1, nextId)
    expect(out[0]).toMatchObject({ text: '<b>hi</b> joined' })
  })
})

describe('groupRows', () => {
  const MIN = 60_000
  it('shows the sender header on the first message of a run only', () => {
    const rows = groupRows([msg('1', 'a', 0), msg('2', 'a', MIN), msg('3', 'a', 2 * MIN)])
    expect(rows.map((r) => r.showHeader)).toEqual([true, false, false])
  })
  it('starts a new header for a different sender', () => {
    const rows = groupRows([msg('1', 'a', 0), msg('2', 'b', 1000), msg('3', 'a', 2000)])
    expect(rows.map((r) => r.showHeader)).toEqual([true, true, true])
  })
  it('starts a new header after a long gap from the same sender', () => {
    const rows = groupRows([msg('1', 'a', 0), msg('2', 'a', 6 * MIN)])
    expect(rows.map((r) => r.showHeader)).toEqual([true, true])
  })
  it('the gap is measured from the previous message, so a steady chat stays grouped', () => {
    const rows = groupRows([msg('1', 'a', 0), msg('2', 'a', 4 * MIN), msg('3', 'a', 8 * MIN)])
    expect(rows.map((r) => r.showHeader)).toEqual([true, false, false])
  })
  it('an event line breaks the run', () => {
    const rows = groupRows([msg('1', 'a', 0), evt('x', 1000), msg('2', 'a', 2000)])
    expect(rows.map((r) => r.showHeader)).toEqual([true, false, true])
  })
  it('keeps removed messages in place and groups them like any other', () => {
    const rows = groupRows([msg('1', 'a', 0, '', true), msg('2', 'a', 1000)])
    expect(rows.map((r) => [r.item.id, r.showHeader])).toEqual([['1', true], ['2', false]])
  })
  it('returns nothing for nothing', () => {
    expect(groupRows([])).toEqual([])
  })
})

describe('formatClock', () => {
  it('formats a time as hours and minutes in the given zone', () => {
    const at = Date.UTC(2026, 9, 8, 14, 5)
    expect(formatClock(at, { locale: 'en-GB', timeZone: 'UTC' })).toBe('14:05')
    expect(formatClock(at, { locale: 'en-GB', timeZone: 'Asia/Manila' })).toBe('22:05')
  })
  it('never throws on odd input', () => {
    expect(() => formatClock(Number.NaN)).not.toThrow()
    expect(formatClock(Number.NaN)).toBe('')
  })
})
