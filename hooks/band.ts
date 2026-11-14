import type { SessionRateLimit } from 'claude-code'

import type { Row, Snapshot, Stats } from '../types'
import { colourOf, columnsOf, kTokens, lpad, pad, shortName } from './categories'

// The band: everything above the prompt, as plain text parts ready to draw.
// The drawing hook reads the engine, calls `band`, and maps each part to a Text.

// One run of text: drawn in `colour`, else dim when `dim`, else plain. `id` is its key.
export type Part = { id: string; text: string; colour?: string; dim?: boolean }

// One cell of the Context box: a swatch in the category's colour, then dim `text`.
export type Cell = { category: string; text: string; swatch: string }

export type BandInput = {
  snapshot: Snapshot
  stats: Stats
  compact: boolean
  // `$.clock.now()`, in milliseconds.
  now: number
  // The prompt cache's lifetime; 60 minutes when absent.
  ttlMs?: number
  // Columns the band may fill.
  columns: number
}

export type Band =
  // One line: bar, percent and stats, fitted so their text plus `details` fills `columns`.
  | { view: 'compact'; line: Part[]; details: string }
  // The bar with its percent, then a part list per box; a box with nothing to say is absent.
  | { view: 'detail'; bar: Part[]; context: Cell[][]; limits: Part[]; busy?: Part[]; cache?: Part[] }

// ---- Internals: none of what follows is part of the interface.

type Level = 'normal' | 'warn' | 'critical'

// Hangar 18 yellow at 70%, pink at 90%; under 70% the piece is drawn dim.
const WARN = '#FFDB35'
const CRITICAL = '#FF498E'

const level = (percent: number): Level => (percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'normal')

const levelColour = (l: Level) => (l === 'critical' ? CRITICAL : l === 'warn' ? WARN : undefined)

const ORDER = ['five_hour', 'seven_day']

// The 5-hour and all-models weekly windows, in that order; a gateway's spend limit is left out.
const windowsOf = (limits: readonly SessionRateLimit[]) =>
  ORDER.flatMap(kind => limits.filter(l => l.kind === kind).slice(0, 1))

const windowName = (kind: string, compact: boolean) =>
  kind === 'five_hour' ? (compact ? '5h' : '5-hour') : kind === 'seven_day' ? (compact ? 'wk' : 'Weekly') : kind

const meter = (percent: number) => {
  const on = Math.min(5, Math.max(0, Math.round(percent / 20)))
  return '▰'.repeat(on) + '▱'.repeat(5 - on)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const countdown = (ms: number) => {
  const m = Math.max(1, Math.ceil(ms / 60000))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

// When the window resets, once it is 70% full: a countdown for 5h, local weekday and time for weekly.
const resetLabel = (limit: SessionRateLimit, now: number) => {
  if (level(limit.percentUsed) === 'normal' || !limit.resetsAt) return undefined
  const at = new Date(limit.resetsAt)
  if (Number.isNaN(at.getTime())) return undefined
  if (limit.kind === 'five_hour') return at.getTime() > now ? `↻ ${countdown(at.getTime() - now)}` : undefined
  return `↻ ${DAYS[at.getDay()]} ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
}

// One window as text: `5h ▰▰▱▱▱ 38%`, plus `↻ ...` at 70% and up.
const windowLabel = (limit: SessionRateLimit, now: number, compact: boolean) => {
  const reset = resetLabel(limit, now)
  const base = `${windowName(limit.kind, compact)} ${meter(limit.percentUsed)} ${Math.round(limit.percentUsed)}%`
  return reset ? `${base} ${reset}` : base
}

const agentTime = (ms: number) => {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

const turnsLabel = (n: number) => `${n} ${n === 1 ? 'turn' : 'turns'}`

// One used segment of the bar; `isBreak` ends it in a half block so the next colour starts after a gap.
const segment = (width: number, isBreak: boolean) =>
  width <= 0 ? '' : isBreak ? '█'.repeat(width - 1) + '▌' : '█'.repeat(width)

const MIN_BAR = 20

type Piece = { id: string; width: number }

// Fits the compact line: `fixed` is what always stays (percent label, Details button),
// `droppable` is in drop order (first dropped first). Pieces go until the bar has MIN_BAR
// cells; the bar then takes every cell left over, and never fewer than MIN_BAR.
const fit = (columns: number, fixed: number, droppable: readonly Piece[]) => {
  const kept = [...droppable]
  const room = () => columns - fixed - kept.reduce((a, p) => a + p.width, 0)
  while (kept.length > 0 && room() < MIN_BAR) kept.shift()
  return { keep: kept.map(p => p.id), bar: Math.max(MIN_BAR, room()) }
}

// A length of time to the minute: `48m`, `2h 13m`, `3d 4h`.
const span = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`
}

// Prompt cache lifetime on a subscription; CONTEXT_BAR_CACHE_TTL_MIN overrides it.
const CACHE_TTL_MIN = 60

type Cache = {
  isWarm: boolean
  leftMs: number
  idleMs: number
  colour?: string
  // Why a cold cache is cold: its lifetime ran out, or a compaction rewrote the conversation it held.
  reason?: 'expired' | 'compacted'
}

// The prompt cache, counted from the end of the last main turn: warm until the TTL runs out,
// yellow in its last 10 minutes, pink once it has gone cold. A compaction since then makes it
// cold at once, since the compacted conversation was never cached. Nothing to show before a turn.
const cacheOf = (s: { lastAt?: number; compactedAt?: number }, now: number, ttlMs: number): Cache | undefined => {
  if (s.compactedAt !== undefined) {
    return { isWarm: false, leftMs: 0, idleMs: Math.max(0, now - s.compactedAt), colour: CRITICAL, reason: 'compacted' }
  }
  if (s.lastAt === undefined) return undefined
  const idleMs = Math.max(0, now - s.lastAt)
  const leftMs = ttlMs - idleMs
  if (leftMs <= 0) return { isWarm: false, leftMs: 0, idleMs, colour: CRITICAL, reason: 'expired' }
  return { isWarm: true, leftMs, idleMs, colour: leftMs <= 10 * 60000 ? WARN : undefined }
}

// The compact line's text: `cache 48m left`, `cache cold · idle 2h 13m`, or `cache cold · compacted`.
const cacheLabel = (c: Cache) =>
  c.isWarm
    ? `cache ${span(c.leftMs + 59999)} left`
    : c.reason === 'compacted'
      ? 'cache cold · compacted'
      : `cache cold · idle ${span(c.idleMs)}`

const GAP = '  '
const DETAILS = '[Details]'

const coloured = (id: string, text: string, colour: string | undefined): Part =>
  colour ? { id, text, colour } : { id, text, dim: true }

// Largest-remainder split: the cells always add up to exactly `width`.
const cells = (rows: readonly Row[], max: number, width: number) => {
  const exact = rows.map(r => (max > 0 ? (r.tokens / max) * width : 0))
  const out = exact.map(Math.floor)
  let left = width - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (let j = 0; left > 0 && order.length > 0; j = (j + 1) % order.length, left--) {
    const i = order[j]![1]
    out[i] = out[i]! + 1
  }
  return out
}

const barParts = (snap: Snapshot, width: number): Part[] => {
  const used = snap.rows.filter(r => r.kind === 'used')
  // Over the cap the used rows fill the whole bar instead of overflowing it.
  const widths = cells(snap.rows, Math.max(snap.max, snap.rows.reduce((a, r) => a + r.tokens, 0)), width)
  // A used segment that meets another used one ends in a half block, leaving a thin gap.
  const nextShown = (i: number) => snap.rows.find((_, j) => j > i && (widths[j] ?? 0) > 0)
  return snap.rows.map((r, i) =>
    r.kind === 'used'
      ? { id: `s${i}`, text: segment(widths[i] ?? 0, nextShown(i)?.kind === 'used'), colour: colourOf(used, r) }
      : { id: `s${i}`, text: (r.kind === 'free' ? '░' : '▒').repeat(widths[i] ?? 0), dim: true },
  )
}

export const band = ({ snapshot: snap, stats: s, compact, now, ttlMs, columns }: BandInput): Band => {
  const label = ` ${Math.round(snap.percent)}% of ${kTokens(snap.max)}`
  const labelColour = levelColour(level(snap.percent))
  const percent: Part = labelColour ? { id: 'pct', text: label, colour: labelColour } : { id: 'pct', text: label }
  const windows = windowsOf(s.limits)
  const windowPart = (id: string, l: (typeof windows)[number], short: boolean) =>
    coloured(id, windowLabel(l, now, short), levelColour(level(l.percentUsed)))
  const hasBusy = s.turns > 0 || s.busyMs > 0
  const cache = cacheOf(s, now, ttlMs ?? CACHE_TTL_MIN * 60000)

  if (compact) {
    const busy = `${GAP}busy ${agentTime(s.busyMs)}`
    const turns = ` · ${turnsLabel(s.turns)}`
    const cacheLine = cache && `${GAP}${cacheLabel(cache)}`
    // In drop order: turns, busy time, weekly window, cache, 5-hour window.
    const fiveHour = windows.filter(l => l.kind === 'five_hour')
    const weekly = windows.filter(l => l.kind !== 'five_hour')
    const windowPiece = (l: (typeof windows)[number]) => ({ id: l.kind, width: GAP.length + windowLabel(l, now, true).length })
    const pieces: Piece[] = [
      ...(hasBusy ? [{ id: 'turns', width: turns.length }, { id: 'busy', width: busy.length }] : []),
      ...weekly.map(windowPiece),
      ...(cacheLine ? [{ id: 'cache', width: cacheLine.length }] : []),
      ...fiveHour.map(windowPiece),
    ]
    const { keep, bar } = fit(columns, label.length + GAP.length + DETAILS.length, pieces)
    const line: Part[] = [
      ...barParts(snap, bar),
      percent,
      ...windows
        .filter(l => keep.includes(l.kind))
        .flatMap(l => [{ id: `g${l.kind}`, text: GAP }, windowPart(`w${l.kind}`, l, true)]),
      ...(keep.includes('busy') ? [{ id: 'busy', text: busy, dim: true }] : []),
      ...(keep.includes('turns') ? [{ id: 'turns', text: turns, dim: true }] : []),
      ...(cache && cacheLine && keep.includes('cache') ? [coloured('cache', cacheLine, cache.colour)] : []),
      { id: 'end', text: GAP },
    ]
    return { view: 'compact', line, details: DETAILS }
  }

  const used = snap.rows.filter(r => r.kind === 'used')
  const context = columnsOf(used).map(col => {
    const nameW = Math.max(...col.map(r => shortName(r.name).length))
    const tokW = Math.max(...col.map(r => kTokens(r.tokens).length))
    return col.map(r => ({
      category: r.name,
      text: ` ${pad(shortName(r.name), nameW)} ${lpad(kTokens(r.tokens), tokW)}`,
      swatch: colourOf(used, r),
    }))
  })
  // What the next request sends again: everything in the window now.
  const recache = used.reduce((a, r) => a + r.tokens, 0)
  return {
    view: 'detail',
    bar: [...barParts(snap, Math.max(20, columns - label.length - 1)), percent],
    context,
    limits: windows.map(l => windowPart(`d${l.kind}`, l, false)),
    busy: hasBusy
      ? [
          { id: 'busy-time', text: agentTime(s.busyMs), dim: true },
          { id: 'busy-turns', text: turnsLabel(s.turns), dim: true },
        ]
      : undefined,
    cache: cache && [
      coloured(
        'cache-state',
        cache.isWarm ? `warm, ${span(cache.leftMs + 59999)} left` : cache.reason === 'compacted' ? 'cold, compacted' : 'cold',
        cache.colour,
      ),
      { id: 'idle', text: `idle ${span(cache.idleMs)}`, dim: true },
      ...(cache.isWarm ? [] : [{ id: 'recache', text: `next message re-caches ~${kTokens(recache)}`, dim: true }]),
    ],
  }
}
