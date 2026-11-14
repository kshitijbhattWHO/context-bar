import { expect, test } from 'claude-code/testing'

import { measure } from './measure'

type Kind = 'used' | 'free' | 'buffer' | 'deferred'
const cat = (name: string, tokens: number, kind: Kind) => ({ name, tokens, kind, color: 'inactive', isDeferred: kind === 'deferred' })
const breakdown = (messages: number, rawMaxTokens = 200000) => ({
  rawMaxTokens,
  categories: [
    cat('System prompt', 8000, 'used'),
    cat('MCP tools', 0, 'used'),
    cat('Messages', messages, 'used'),
    cat('MCP tools (deferred)', 40000, 'deferred'),
    cat('Free space', 160000 - messages, 'free'),
    cat('Autocompact buffer', 32000, 'buffer'),
  ],
}) as never

test('without a budget 100% is the window; empty and deferred rows are left out', async () => {
  const m = measure(breakdown(60000))
  expect(m.rows.map(r => r.name)).toEqual(['System prompt', 'Messages', 'Free space', 'Autocompact buffer'])
  expect(m).toMatchObject({ max: 200000, usedTokens: 68000, percent: 34 })
})

test('a message budget puts 100% at what loads up front plus the budget, and refills free space to it', async () => {
  const m = measure(breakdown(60000), 120000)
  expect(m.max).toBe(128000)
  expect(m.usedTokens).toBe(68000)
  expect(m.percent).toBe(53.125)
  expect(m.rows).toEqual([
    { name: 'System prompt', tokens: 8000, kind: 'used' },
    { name: 'Messages', tokens: 60000, kind: 'used' },
    { name: 'Free space', tokens: 60000, kind: 'free' },
  ])
})

test('over the budget free space is empty and the percent goes past 100', async () => {
  const m = measure(breakdown(150000), 100000)
  expect(m.rows.at(-1)).toEqual({ name: 'Free space', tokens: 0, kind: 'free' })
  expect(Math.round(m.percent)).toBe(146)
})

test('a budget of 0 or less is no budget', async () => {
  expect(measure(breakdown(60000), 0).max).toBe(200000)
  expect(measure(breakdown(60000), -5).max).toBe(200000)
})
