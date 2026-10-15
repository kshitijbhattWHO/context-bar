import { expect, test } from 'claude-code/testing'

test('context-lines all ranks every itemised line', async ($, on) => {
  on('env.get', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: {
    window: 200000,
    context: {
      window: 200000,
      breakdown: {
        categories: [
          { name: 'System prompt', tokens: 3000, kind: 'used', color: 'promptBorder', isDeferred: false },
          { name: 'System tools', tokens: 500, kind: 'used', color: 'inactive', isDeferred: false },
          { name: 'Free space', tokens: 100000, kind: 'free', color: 'inactive', isDeferred: false },
        ],
        totalTokens: 3500,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        percentage: 2,
        memoryFiles: [{ path: 'C:/x/CLAUDE.md', type: 'Project', tokens: 1200 }],
        mcpTools: [
          { name: 'mcp__a__one', serverName: 'a', tokens: 300, isLoaded: true },
          { name: 'mcp__a__two', serverName: 'a', tokens: 200, isLoaded: true },
          { name: 'mcp__b__three', serverName: 'b', tokens: 900, isLoaded: false },
        ],
        agents: [],
      },
    },
  } }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x'.repeat(400), scope: 'shared' }] }) as never)
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'y'.repeat(40), mcp: false }] }) as never)

  const { text = '' } = await $.command.run({
    command: 'context-lines',
    args: 'all',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  const out = text.split('\n')
  expect(out[0]).toBe('Context: 3.5k of 200.0k (2%)')

  const start = out.findIndex(l => l.startsWith('Top '))
  const names = out
    .slice(start + 1)
    .filter(l => /^ {0,6}\S+ {2}/.test(l))
    .map(l => l.trim().split(/\s+/)[1])
  expect(names).toEqual(['C:/x/CLAUDE.md', 'a', 'mcp__a__one', 'mcp__a__two', 'intro', 'Bash', 'b'])
  expect(text).toMatch(/\bb +0\/1 tools in window/)
})

test('CONTEXT_BAR_MAX_TOKENS caps what counts as 100%', async ($, on) => {
  on('env.get', () => ({ value: '150000' }) as never)
  on('session.usage', () => ({ value: {
    window: 1000000,
    context: {
      window: 1000000,
      breakdown: {
        categories: [{ name: 'Messages', tokens: 75000, kind: 'used', color: 'inactive', isDeferred: false }],
        totalTokens: 75000,
        maxTokens: 1000000,
        rawMaxTokens: 1000000,
        percentage: 7.5,
        memoryFiles: [],
        mcpTools: [],
        agents: [],
      },
    },
  } }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  on('tool.list', () => ({ value: [] }) as never)

  const { text = '' } = await $.command.run({
    command: 'context-lines',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(text.split('\n')[0]).toBe('Context: 75.0k of 150.0k (50%)')
})
