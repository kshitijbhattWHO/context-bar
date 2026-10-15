import { test, expect } from 'claude-code/testing'

const breakdown = {
  categories: [
    { name: 'System prompt', tokens: 3000, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 500, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 100000, color: 'x', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 3500,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'auto',
  percentage: 2,
  gridRows: [],
  model: 'test',
  memoryFiles: [{ path: 'C:/x/CLAUDE.md', type: 'Project', tokens: 1200 }],
  mcpTools: [
    { name: 'mcp__a__one', serverName: 'a', tokens: 300, isLoaded: true },
    { name: 'mcp__a__two', serverName: 'a', tokens: 200, isLoaded: true },
    { name: 'mcp__b__three', serverName: 'b', tokens: 900, isLoaded: false },
  ],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
} as const

test('/context-lines ranks files, servers and sections by tokens', async ($, on) => {
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, breakdown }, rateLimits: {} },
  }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'a'.repeat(400), scope: 'shared' }] }))
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'x'.repeat(40), mcp: false }] }) as never)

  const { text } = await $.command.run({ command: 'context-lines', args: 'all' } as never)
  const out = text!.split('\n')
  expect(out[0]).toBe('Context: 3.5k of 200.0k (2%)')
  const ranked = out.filter(l => /^ *\d/.test(l)).map(l => l.trim().split(/\s+/)[2])
  // CLAUDE.md 1200 > server a 500 > tool one 300 > tool two 200 > intro 100 > Bash 10 > server b (0 loaded)
  expect(ranked).toEqual(['C:/x/CLAUDE.md', 'a', 'mcp__a__one', 'mcp__a__two', 'intro', 'Bash', 'b'])
  expect(text).toMatch(/\bb +0\/1 tools in window/)
})
