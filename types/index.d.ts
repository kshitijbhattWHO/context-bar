export type Row = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Snapshot = { rows: Row[]; max: number; percent: number }
export type Line = { category: string; kind: string; name: string; tokens: number; note: string }
export type Detail = { category: string; lines: Line[] }
export type Tests = { state: 'none' | 'pass' | 'fail' | 'stale'; passed?: number; failed?: number }
export type Stats = { turns: number; busyMs: number; tests: Tests; limits: import('claude-code').SessionRateLimit[] }

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
