import type { Row, Snapshot, Stats } from '../types'
import { colourOf, columnsOf, kTokens, lpad, pad, shortName } from './categories'
import {
  agentTime,
  CACHE_TTL_MIN,
  cacheLabel,
  cacheOf,
  fit,
  level,
  levelColour,
  segment,
  span,
  turnsLabel,
  windowLabel,
  windowsOf,
} from './stats'
import type { Piece } from './stats'

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
