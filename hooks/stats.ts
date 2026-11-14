import type { SessionRateLimit } from 'claude-code'

// The band's pure helpers: plain values in, plain values out, no engine access.

export type Level = 'normal' | 'warn' | 'critical'

// Hangar 18 yellow at 70%, pink at 90%; under 70% the piece is drawn dim.
export const WARN = '#FFDB35'
export const CRITICAL = '#FF498E'

export const level = (percent: number): Level => (percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'normal')

export const levelColour = (l: Level) => (l === 'critical' ? CRITICAL : l === 'warn' ? WARN : undefined)

const ORDER = ['five_hour', 'seven_day']

// The 5-hour and all-models weekly windows, in that order; a gateway's spend limit is left out.
export const windowsOf = (limits: readonly SessionRateLimit[]) =>
  ORDER.flatMap(kind => limits.filter(l => l.kind === kind).slice(0, 1))

export const windowName = (kind: string, compact: boolean) =>
  kind === 'five_hour' ? (compact ? '5h' : '5-hour') : kind === 'seven_day' ? (compact ? 'wk' : 'Weekly') : kind

export const meter = (percent: number) => {
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
export const resetLabel = (limit: SessionRateLimit, now: number) => {
  if (level(limit.percentUsed) === 'normal' || !limit.resetsAt) return undefined
  const at = new Date(limit.resetsAt)
  if (Number.isNaN(at.getTime())) return undefined
  if (limit.kind === 'five_hour') return at.getTime() > now ? `↻ ${countdown(at.getTime() - now)}` : undefined
  return `↻ ${DAYS[at.getDay()]} ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
}

// One window as text: `5h ▰▰▱▱▱ 38%`, plus `↻ ...` at 70% and up.
export const windowLabel = (limit: SessionRateLimit, now: number, compact: boolean) => {
  const reset = resetLabel(limit, now)
  const base = `${windowName(limit.kind, compact)} ${meter(limit.percentUsed)} ${Math.round(limit.percentUsed)}%`
  return reset ? `${base} ${reset}` : base
}

export const agentTime = (ms: number) => {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

export const turnsLabel = (n: number) => `${n} ${n === 1 ? 'turn' : 'turns'}`

// One used segment of the bar; `isBreak` ends it in a half block so the next colour starts after a gap.
export const segment = (width: number, isBreak: boolean) =>
  width <= 0 ? '' : isBreak ? '█'.repeat(width - 1) + '▌' : '█'.repeat(width)

export const MIN_BAR = 20

export type Piece = { id: string; width: number }

// Fits the compact line: `fixed` is what always stays (percent label, Details button),
// `droppable` is in drop order (first dropped first). Pieces go until the bar has MIN_BAR
// cells; the bar then takes every cell left over, and never fewer than MIN_BAR.
export const fit = (columns: number, fixed: number, droppable: readonly Piece[]) => {
  const kept = [...droppable]
  const room = () => columns - fixed - kept.reduce((a, p) => a + p.width, 0)
  while (kept.length > 0 && room() < MIN_BAR) kept.shift()
  return { keep: kept.map(p => p.id), bar: Math.max(MIN_BAR, room()) }
}

const SHORT: Record<string, string> = {
  'System prompt': 'Prompt',
  'System tools': 'Tools',
  'MCP server instructions': 'MCP',
  'Memory files': 'Memory',
}

// The label a category gets in the Context box and the pane's tabs.
export const shortName = (name: string) => SHORT[name] ?? name

// The Context box's cells: 2 rows, largest first, filled down each column.
// Largest first: the order of the Context box's cells and of the pane's tabs.
export const bySize = <T extends { tokens: number }>(items: readonly T[]) => [...items].sort((a, b) => b.tokens - a.tokens)

export const columnsOf = <T extends { tokens: number }>(items: readonly T[]): T[][] => {
  const sorted = bySize(items)
  const out: T[][] = []
  for (let i = 0; i < sorted.length; i += 2) out.push(sorted.slice(i, i + 2))
  return out
}

// Rows a wrapping run of items takes: an item that doesn't fit what's left of a row starts the next.
export const wrappedRows = (widths: readonly number[], columns: number) => {
  let rows = 0
  let left = 0
  for (const w of widths) {
    if (rows === 0 || w > left) {
      rows++
      left = columns
    }
    left -= w
  }
  return rows
}
