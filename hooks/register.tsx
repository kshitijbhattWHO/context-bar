import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { Detail, Line, Row, Snapshot } from '../types'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)
const detail = atom({ plugin: 'context-bar', key: 'detail' } as const, null)
const PANE = 'context-lines'

// Hangar 18 palette: primary purple first, then the secondaries, purple-light, white.
const BRAND = ['#6F02E4', '#00BCFF', '#FF498E', '#FFDB35', '#B876FE', '#FFFFFF']

const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length))
const lpad = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s)

// Largest-remainder split so the cells always sum to exactly `width`.
const cells = (rows: Row[], max: number, width: number) => {
  const exact = rows.map(r => (r.tokens / max) * width)
  const out = exact.map(Math.floor)
  let left = width - out.reduce((a, b) => a + b, 0)
  exact
    .map((x, i) => [x - Math.floor(x), i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => left-- > 0 && (out[i] = (out[i] ?? 0) + 1))
  return out
}

const refresh = async ($: EngineInterface) => {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  if (!b) return
  const rows: Row[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind as Row['kind'] }))
  const snap: Snapshot = { rows, max: b.rawMaxTokens, percent: b.percentage }
  await update($, snapshot, () => snap)
}

// Every itemised line behind the bar's rows, largest first.
// ponytail: `category` is the row's name as /context prints it; the breakdown gives no other key.
const lines = async ($: EngineInterface, b: SessionContextBreakdown, withTools: boolean) => {
  const out: Line[] = []
  for (const f of b.memoryFiles)
    out.push({ category: 'Memory files', kind: 'file', name: f.path, tokens: f.tokens, note: f.type })

  const servers = new Map<string, { tokens: number; loaded: number; total: number }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { tokens: 0, loaded: 0, total: 0 }
    s.total++
    if (t.isLoaded) {
      s.loaded++
      s.tokens += t.tokens
    }
    servers.set(t.serverName, s)
    if (withTools && t.isLoaded)
      out.push({ category: 'MCP tools', kind: 'tool', name: t.name, tokens: t.tokens, note: t.serverName })
  }
  for (const [name, s] of servers)
    out.push({ category: 'MCP tools', kind: 'mcp', name, tokens: s.tokens, note: `${s.loaded}/${s.total} tools in window` })

  for (const s of b.skills?.skillFrontmatter ?? [])
    out.push({ category: 'Skills', kind: 'skill', name: s.name, tokens: s.tokens, note: s.pluginName ?? s.source })
  if (b.slashCommands)
    out.push({
      category: 'Skills',
      kind: 'cmds',
      name: 'slash-command listing',
      tokens: b.slashCommands.tokens,
      note: `${b.slashCommands.includedCommands}/${b.slashCommands.totalCommands}`,
    })
  for (const a of b.agents)
    out.push({ category: 'Custom agents', kind: 'agent', name: a.agentType, tokens: a.tokens, note: a.source })

  // ponytail: sections and built-in tools are chars/4 (the engine counts rows, not these)
  for (const s of (await $.prompt.compose()).sections)
    out.push({ category: 'System prompt', kind: 'prompt', name: s.id, tokens: Math.round(s.text.length / 4), note: s.scope })
  for (const t of await $.tool.list())
    if (!t.mcp)
      out.push({
        category: 'System tools',
        kind: 'tool',
        name: t.name,
        tokens: Math.round(t.description.length / 4),
        note: '~ description only',
      })

  return out.sort((x, y) => y.tokens - x.tokens)
}

const show = async ($: EngineInterface, category: string) => {
  const { context } = await $.session.usage({ breakdown: 'full' })
  const all = context.breakdown ? await lines($, context.breakdown, true) : []
  const d: Detail = { category, lines: all.filter(l => l.category === category) }
  await update($, detail, () => d)
  await $.ui.open({ id: PANE, title: category, focus: true, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Toggle the context window bar above the prompt',
    })
    await $.command.register({
      name: 'context-lines',
      description: 'Rank what fills the context window: files, MCP servers, skills, agents, prompt sections',
      argumentHint: '[top N, default 40] [all]',
    })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    const now = !(await read($, isOn))
    await update($, isOn, () => now)
    if (now) await refresh($)
    return { text: `Context bar ${now ? 'on' : 'off'}.` }
  })

  on('command.run', { command: 'context-lines' }, async ($, e) => {
    const args = e.args ?? ''
    const top = Number(args.match(/\d+/)?.[0] ?? 40)
    const { context } = await $.session.usage({ breakdown: 'full' })
    const b = context.breakdown
    if (!b) return { text: 'context-lines: no breakdown available (no session bound).' }

    const all = await lines($, b, /\ball\b/.test(args))
    const used = b.categories.filter(c => c.kind === 'used')
    const deferred = b.categories.find(c => c.kind === 'deferred')
    const w = Math.min(60, Math.max(...all.map(l => l.name.length), 10))
    const out = [
      `Context: ${kTokens(b.totalTokens)} of ${kTokens(b.rawMaxTokens)} (${b.percentage}%)`,
      used.map(c => `${c.name} ${kTokens(c.tokens)}`).join(' | '),
      deferred ? `Deferred (outside the window, loaded on search): ${kTokens(deferred.tokens)}` : '',
      '',
      `Top ${Math.min(top, all.length)} of ${all.length} lines by tokens:`,
      ...all.slice(0, top).map(l => `${lpad(kTokens(l.tokens), 7)}  ${pad(l.kind, 6)} ${pad(l.name, w)}  ${l.note ?? ''}`),
      '',
      'Cut: /mcp to disable a server; /plugin to disable a plugin and its skills; CLAUDE.md and memory files by path above.',
      'Pass "all" to list each MCP tool schema on its own line. Click a row in the context bar for one category.',
    ]
    return { text: out.filter(l => l !== '').join('\n') }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (await read($, isOn)) await refresh($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const d = await read($, detail)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 3)
    const list = d?.lines ?? []
    const w = Math.min(50, Math.max(...list.map(l => l.name.length), 4))
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{d?.category ?? ''} </Text>
          <Text dimColor>
            {list.length} lines, {kTokens(list.reduce((a, l) => a + l.tokens, 0))}{' '}
          </Text>
          <Button key="close" label="Close" plain hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {list.length === 0 && <Text dimColor>Nothing itemised for this row.</Text>}
        {list.slice(0, room).map(l => (
          <Text>
            {lpad(kTokens(l.tokens), 7)}  {pad(l.name, w)}  <Text dimColor>{l.note ?? ''}</Text>
          </Text>
        ))}
        {list.length > room && <Text dimColor>+{list.length - room} more: /context-lines all</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || !snap || !(await read($, isOn))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const label = ` ${Math.round(snap.percent)}% of ${kTokens(snap.max)}`
    const width = Math.max(10, (e.viewport?.columns ?? 80) - label.length - 1)
    const widths = cells(snap.rows, snap.max, width)
    const used = snap.rows.filter(r => r.kind === 'used')
    const colour = (r: Row) => BRAND[used.indexOf(r) % BRAND.length]

    return (
      <Box flexDirection="column">
        <Text>
          {snap.rows.map((r, i) =>
            r.kind === 'used' ? (
              <Text color={colour(r)}>{'█'.repeat(widths[i] ?? 0)}</Text>
            ) : (
              <Text dimColor>{(r.kind === 'free' ? '░' : '▒').repeat(widths[i] ?? 0)}</Text>
            ),
          )}
          <Text>{label}</Text>
        </Text>
        <Box>
          {used.map(r => (
            <Box>
              <Text color={colour(r)}>■</Text>
              <Button key={r.name} plain dimColor label={` ${r.name} ${kTokens(r.tokens)}  `} onPress={() => show($, r.name)} />
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
