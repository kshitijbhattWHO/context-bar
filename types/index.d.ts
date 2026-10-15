export type Row = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' }
export type Snapshot = { rows: Row[]; max: number; percent: number }
export type Line = { category: string; kind: string; name: string; tokens: number; note?: string }
export type Detail = { category: string; lines: Line[] }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { snapshot: Snapshot | null; isOn: boolean; detail: Detail | null }
  }
}
