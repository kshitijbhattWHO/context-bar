import type { SessionContextBreakdown } from 'claude-code'

import type { Row, Snapshot } from '../types'

// What 100% of the context window means, and how full it is.
// Plain values in, a Snapshot out, no engine access.

// Without a message budget 100% is the engine's window. With one, 100% is whatever loads up front
// (every used category but Messages) plus `budget` message tokens, and Free space is refilled to it.
// Either way `usedTokens` is the sum of the used categories: what the bar draws.
export const measure = (b: Pick<SessionContextBreakdown, 'categories' | 'rawMaxTokens'>, budget?: number): Snapshot => {
  const shown: Row[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind as Row['kind'] }))
  const used = shown.filter(r => r.kind === 'used')
  const usedTokens = used.reduce((a, r) => a + r.tokens, 0)
  if (!(budget !== undefined && budget > 0)) {
    const max = b.rawMaxTokens
    return { rows: shown, max, percent: max > 0 ? (usedTokens / max) * 100 : 0, usedTokens }
  }
  const upFront = used.filter(r => r.name !== 'Messages').reduce((a, r) => a + r.tokens, 0)
  const max = upFront + budget
  // The engine's free and buffer rows measure its window, not the budget: refill free space instead.
  const rows: Row[] = [...used, { name: 'Free space', tokens: Math.max(0, max - usedTokens), kind: 'free' }]
  return { rows, max, percent: (usedTokens / max) * 100, usedTokens }
}
