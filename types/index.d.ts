export type Row = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
// usedTokens: the used categories added up; percent is it over max.
export type Snapshot = { rows: Row[]; max: number; percent: number; usedTokens: number }
export type Line = { category: string; kind: string; name: string; tokens: number; note: string }
// One tab of the side pane: a used category, with its colour in the bar.
export type Tab = { name: string; tokens: number; colour: string }
export type Detail = { category: string; lines: Line[]; tabs: Tab[] }
// A rate-limit window as session.measure reports it (SessionRateLimit), kept self-contained here.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// lastAt: when the last main turn ended, in $.clock.now() ms; the prompt cache counts from it.
// compactedAt: when the main conversation was last compacted, until the next main turn re-caches it.
export type Stats = { turns: number; busyMs: number; limits: Limit[]; lastAt?: number; compactedAt?: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      snapshot: Snapshot | null
      isOn: boolean
      detail: Detail | null
      stats: Stats
      compact: boolean
      // Bumped each minute while a cache countdown shows, so the band redraws.
      tick: number
    }
  }
}
