import type { Row } from '../types'

// The categories of the context window: their names, colours, sizes and layout in the
// Context box and the pane's tabs. Plain values in, plain values out, no engine access.

// Hangar 18 palette: primary purple first, then the secondaries, purple-light, white.
export const BRAND = ['#6F02E4', '#00BCFF', '#FF498E', '#FFDB35', '#B876FE', '#FFFFFF']

// Each used category keeps its colour by its place in the bar.
export const colourOf = (used: readonly Row[], r: Row) => BRAND[used.indexOf(r) % BRAND.length]!

export const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
export const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length))
export const lpad = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s)

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
