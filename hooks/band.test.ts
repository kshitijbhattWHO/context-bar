import { expect, test } from 'claude-code/testing'

import type { Limit, Row, Snapshot, Stats } from '../types'
import { band } from './band'
import type { BandInput, Part } from './band'

// Sat 14 Nov 2026, 10:00 local time.
const NOW = new Date(2026, 10, 14, 10, 0).getTime()
const MIN = 60000
const at = (ms: number) => new Date(NOW + ms).toISOString()
const WARN = '#FFDB35'
const CRITICAL = '#FF498E'

const rows = (messages: number): Row[] => [
  { name: 'System prompt', tokens: 8000, kind: 'used' },
  { name: 'Messages', tokens: messages, kind: 'used' },
  { name: 'Free space', tokens: 192000 - messages, kind: 'free' },
]
const SNAP: Snapshot = { rows: rows(60000), max: 200000, percent: 34, usedTokens: 68000 }
const NO_STATS: Stats = { turns: 0, busyMs: 0, limits: [] }
const LIMITS: Limit[] = [
  { kind: 'five_hour', percentUsed: 38, resetsAt: at(100 * MIN) },
  { kind: 'seven_day', percentUsed: 61.5, resetsAt: new Date(2026, 10, 19, 9, 30).toISOString() },
  { kind: 'spend_limit', percentUsed: 99 },
]
const BUSY: Stats = { turns: 33, busyMs: 3134000, limits: LIMITS, lastAt: NOW }

const input = (over: Partial<BandInput> = {}): BandInput => ({
  snapshot: SNAP,
  stats: NO_STATS,
  compact: true,
  now: NOW,
  columns: 160,
  ...over,
})
const compactOf = (over: Partial<BandInput> = {}) => {
  const b = band(input({ ...over, compact: true }))
  if (b.view !== 'compact') throw new Error('expected compact')
  return b
}
const detailOf = (over: Partial<BandInput> = {}) => {
  const b = band(input({ ...over, compact: false }))
  if (b.view !== 'detail') throw new Error('expected detail')
  return b
}
const text = (parts: readonly Part[]) => parts.map(p => p.text).join('')
const byId = (parts: readonly Part[], id: string) => parts.find(p => p.id === id)
const barCells = (s: string) => (s.match(/[█▌░▒]/g) ?? []).length
const limitsText = (limits: Limit[]) => detailOf({ stats: { ...NO_STATS, limits } }).limits.map(p => p.text)

test('compact: bar, percent, both windows, busy time, turns and cache fill the line exactly', async () => {
  const b = compactOf({ stats: BUSY })
  const line = text(b.line)
  expect(line).toContain(' 34% of 200.0k  5h ▰▰▱▱▱ 38%  wk ▰▰▰▱▱ 62%  busy 52m · 33 turns  cache 1h left  ')
  expect(b.details).toBe('[Details]')
  expect(line.length + b.details.length).toBe(160)
  expect(line).not.toContain('99%')
})

test('a narrow line drops turns, then busy time, then weekly, then the cache, then 5h; the bar keeps 20 cells', async () => {
  const kept = (columns: number) => {
    const line = text(compactOf({ stats: BUSY, columns }).line)
    return { has: ['turns', 'busy', 'wk', 'cache', '5h'].filter(w => line.includes(w)), bar: barCells(line) }
  }
  expect(kept(160).has).toEqual(['turns', 'busy', 'wk', 'cache', '5h'])
  expect(kept(105).has).toEqual(['busy', 'wk', 'cache', '5h'])
  expect(kept(90).has).toEqual(['wk', 'cache', '5h'])
  expect(kept(80)).toEqual({ has: ['cache', '5h'], bar: 26 })
  expect(kept(64).has).toEqual(['5h'])
  expect(kept(40)).toEqual({ has: [], bar: 20 })
  expect(kept(30)).toEqual({ has: [], bar: 20 })
})

test('the bar splits its cells by tokens, ends a used segment that meets another in a half block, and scales over the cap', async () => {
  const b = compactOf({ columns: 100 })
  const bar = b.line.filter(p => p.id.startsWith('s'))
  expect(bar.map(p => p.text.length).reduce((a, n) => a + n, 0)).toBe(100 - ' 34% of 200.0k  [Details]'.length)
  expect(bar[0]!.text.endsWith('▌')).toBe(true)
  expect(bar[1]!.text.endsWith('█')).toBe(true)
  expect(bar[0]!.colour).toBe('#6F02E4')
  expect(bar[1]!.colour).toBe('#00BCFF')
  expect(bar[2]).toMatchObject({ text: expect.stringMatching(/^░+$/), dim: true })

  const over: Snapshot = { rows: [{ name: 'Messages', tokens: 300000, kind: 'used' }], max: 150000, percent: 200, usedTokens: 300000 }
  const full = detailOf({ snapshot: over, columns: 60 }).bar
  expect(full[0]!.text).toBe('█'.repeat(60 - ' 200% of 150.0k'.length - 1))
})

test('the percent label and the windows are quiet under 70%, yellow from 70%, pink from 90%', async () => {
  expect(byId(compactOf().line, 'pct')).toEqual({ id: 'pct', text: ' 34% of 200.0k' })
  expect(byId(compactOf({ snapshot: { ...SNAP, percent: 70 } }).line, 'pct')?.colour).toBe(WARN)
  expect(byId(compactOf({ snapshot: { ...SNAP, percent: 90 } }).line, 'pct')?.colour).toBe(CRITICAL)
  const parts = (p: number) => detailOf({ stats: { ...NO_STATS, limits: [{ kind: 'five_hour', percentUsed: p }] } }).limits[0]!
  expect(parts(69.9).dim).toBe(true)
  expect(parts(70).colour).toBe(WARN)
  expect(parts(89.9).colour).toBe(WARN)
  expect(parts(90).colour).toBe(CRITICAL)
})

test('only the 5-hour and weekly windows show, 5-hour first; a meter has 5 cells', async () => {
  expect(limitsText([{ kind: 'spend_limit', percentUsed: 95 }, { kind: 'seven_day', percentUsed: 61.5 }, { kind: 'five_hour', percentUsed: 0 }]))
    .toEqual(['5-hour ▱▱▱▱▱ 0%', 'Weekly ▰▰▰▱▱ 62%'])
  expect(limitsText([{ kind: 'five_hour', percentUsed: 38 }])).toEqual(['5-hour ▰▰▱▱▱ 38%'])
  expect(limitsText([{ kind: 'five_hour', percentUsed: 100 }])).toEqual(['5-hour ▰▰▰▰▰ 100%'])
  expect(limitsText([{ kind: 'five_hour', percentUsed: 130 }])).toEqual(['5-hour ▰▰▰▰▰ 130%'])
  expect(limitsText([{ kind: 'spend_limit', percentUsed: 20 }])).toEqual([])
  expect(text(compactOf({ stats: { ...NO_STATS, limits: [{ kind: 'seven_day', percentUsed: 61.5 }] } }).line)).toContain('  wk ▰▰▰▱▱ 62%')
})

test('a window shows when it resets from 70%: a countdown for 5h, the local weekday for weekly', async () => {
  const thu = new Date(2026, 10, 19, 9, 30).toISOString()
  expect(limitsText([{ kind: 'five_hour', percentUsed: 75, resetsAt: at(100 * MIN) }])).toEqual(['5-hour ▰▰▰▰▱ 75% ↻ 1h 40m'])
  expect(limitsText([{ kind: 'five_hour', percentUsed: 92, resetsAt: at(12 * MIN) }])).toEqual(['5-hour ▰▰▰▰▰ 92% ↻ 12m'])
  expect(limitsText([{ kind: 'five_hour', percentUsed: 92, resetsAt: at(-MIN) }])).toEqual(['5-hour ▰▰▰▰▰ 92%'])
  expect(limitsText([{ kind: 'seven_day', percentUsed: 70, resetsAt: thu }])).toEqual(['Weekly ▰▰▰▰▱ 70% ↻ Thu 9:30'])
  expect(limitsText([{ kind: 'seven_day', percentUsed: 69.9, resetsAt: thu }])).toEqual(['Weekly ▰▰▰▱▱ 70%'])
  expect(limitsText([{ kind: 'five_hour', percentUsed: 95 }])).toEqual(['5-hour ▰▰▰▰▰ 95%'])
  expect(limitsText([{ kind: 'five_hour', percentUsed: 95, resetsAt: 'soon' }])).toEqual(['5-hour ▰▰▰▰▰ 95%'])
  expect(text(compactOf({ stats: { ...NO_STATS, limits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: at(60 * MIN) }] } }).line))
    .toContain('  5h ▰▰▰▰▱ 80% ↻ 1h')
})

test('busy time and turns read short, and stay out until there is a turn', async () => {
  const busy = (busyMs: number, turns: number) => detailOf({ stats: { ...NO_STATS, busyMs, turns } }).busy?.map(p => p.text)
  expect(busy(3134000, 33)).toEqual(['52m', '33 turns'])
  expect(busy(45000, 1)).toEqual(['45s', '1 turn'])
  expect(busy(3 * 3600000 + 5 * MIN, 2)).toEqual(['3h 5m', '2 turns'])
  expect(busy(0, 0)).toBeUndefined()
  expect(text(compactOf().line)).not.toContain('busy')
})

test('the cache counts down from the last main turn: quiet, yellow in its last 10 minutes, then pink and cold', async () => {
  const cache = (ago: number, extra: Partial<Stats> = {}, ttlMs?: number) =>
    byId(compactOf({ stats: { ...NO_STATS, lastAt: NOW - ago, ...extra }, ttlMs }).line, 'cache')
  expect(byId(compactOf().line, 'cache')).toBeUndefined()
  expect(cache(13 * MIN)).toEqual({ id: 'cache', text: '  cache 47m left', dim: true })
  expect(cache(55 * MIN)).toEqual({ id: 'cache', text: '  cache 5m left', colour: WARN })
  expect(cache(175 * MIN)).toEqual({ id: 'cache', text: '  cache cold · idle 2h 55m', colour: CRITICAL })
  expect(cache(3 * 24 * 60 * MIN + 4 * 60 * MIN)?.text).toBe('  cache cold · idle 3d 4h')
  expect(cache(2 * MIN, {}, 5 * MIN)?.text).toBe('  cache 3m left')
  expect(cache(0, { compactedAt: NOW - 3 * MIN })).toEqual({ id: 'cache', text: '  cache cold · compacted', colour: CRITICAL })
})

test('Details: a Cache box that says when the next message re-caches the window', async () => {
  const box = (stats: Stats, ttlMs?: number) => detailOf({ stats, ttlMs }).cache?.map(p => p.text)
  expect(box(NO_STATS)).toBeUndefined()
  expect(box({ ...NO_STATS, lastAt: NOW - 2 * MIN }, 5 * MIN)).toEqual(['warm · 3m left', 'idle 2m'])
  expect(box({ ...NO_STATS, lastAt: NOW })).toEqual(['warm · 1h left', 'idle 0s'])
  expect(box({ ...NO_STATS, lastAt: NOW - 61 * MIN })).toEqual(['cold', 'idle 1h 1m', 'next message re-caches ~68.0k'])
  expect(box({ ...NO_STATS, lastAt: NOW - 5 * MIN, compactedAt: NOW - 3 * MIN })).toEqual([
    'cold · compacted',
    'idle 3m',
    'next message re-caches ~68.0k',
  ])
})

test('Details: Context cells, largest first in 2 rows, padded per column, each with its bar colour', async () => {
  const snap: Snapshot = {
    rows: [
      { name: 'System prompt', tokens: 8000, kind: 'used' },
      { name: 'System tools', tokens: 12000, kind: 'used' },
      { name: 'Messages', tokens: 60000, kind: 'used' },
      { name: 'Free space', tokens: 120000, kind: 'free' },
    ],
    max: 200000,
    percent: 40,
    usedTokens: 80000,
  }
  expect(detailOf({ snapshot: snap }).context).toEqual([
    [
      { category: 'Messages', text: ' Messages 60.0k', swatch: '#FF498E' },
      { category: 'System tools', text: ' Tools    12.0k', swatch: '#00BCFF' },
    ],
    [{ category: 'System prompt', text: ' Prompt 8.0k', swatch: '#6F02E4' }],
  ])
})

test('every length of time reads the same way: time left rounds up, time elapsed rounds down, seconds under a minute', async () => {
  const idle = (ms: number) => detailOf({ stats: { ...NO_STATS, lastAt: NOW - ms } }).cache?.[1]?.text
  const left = (ms: number) => detailOf({ stats: { ...NO_STATS, lastAt: NOW - (60 * MIN - ms) } }).cache?.[0]?.text
  expect(idle(30000)).toBe('idle 30s')
  expect(idle(MIN + 59000)).toBe('idle 1m')
  expect(idle(2 * 60 * MIN)).toBe('idle 2h')
  expect(idle(26 * 60 * MIN + 59 * MIN)).toBe('idle 1d 2h')
  expect(idle(48 * 60 * MIN)).toBe('idle 2d')
  expect(left(1000)).toBe('warm · 1m left')
  expect(left(MIN + 1000)).toBe('warm · 2m left')
  const busy = (ms: number) => detailOf({ stats: { ...NO_STATS, busyMs: ms, turns: 1 } }).busy?.[0]?.text
  expect(busy(59900)).toBe('59s')
  expect(busy(3 * 60 * MIN)).toBe('3h')
  expect(busy(25 * 60 * MIN)).toBe('1d 1h')
  const reset = (ms: number) => limitsText([{ kind: 'five_hour', percentUsed: 95, resetsAt: at(ms) }])[0]
  expect(reset(30000)).toBe('5-hour ▰▰▰▰▰ 95% ↻ 1m')
  expect(reset(2 * 60 * MIN)).toBe('5-hour ▰▰▰▰▰ 95% ↻ 2h')
})
