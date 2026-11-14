export type Row = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Snapshot = { rows: Row[]; max: number; percent: number }
export type Line = { category: string; kind: string; name: string; tokens: number; note: string }
// One tab of the side pane: a used category, with its colour in the bar.
export type Tab = { name: string; tokens: number; colour: string }
export type Detail = { category: string; lines: Line[]; tabs: Tab[] }
// A rate-limit window as session.measure reports it (SessionRateLimit), kept self-contained here.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Stats = { turns: number; busyMs: number; limits: Limit[] }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      snapshot: Snapshot | null
      isOn: boolean
      detail: Detail | null
      stats: Stats
      compact: boolean
    }
  }
}
