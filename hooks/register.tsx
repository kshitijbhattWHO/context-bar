import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { Line, Row, Stats, Tab } from '../types'
import { bySize, colourOf, kTokens, lpad, pad, shortName, wrappedRows } from './categories'
import { band } from './band'
import { measure } from './measure'
import type { Part } from './band'

const PANE = 'context-lines'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)
const detail = atom({ plugin: 'context-bar', key: 'detail' } as const, null)
const NO_STATS: Stats = { turns: 0, busyMs: 0, limits: [] }
const stats = atom({ plugin: 'context-bar', key: 'stats' } as const, NO_STATS)
const compact = atom({ plugin: 'context-bar', key: 'compact' } as const, true)
const tick = atom({ plugin: 'context-bar', key: 'tick' } as const, 0)

// CONTEXT_BAR_CACHE_TTL_MIN overrides the prompt cache's lifetime; absent, the band's default.
const ttlOf = async ($: EngineInterface) => {
  const n = Number(await $.env.get('CONTEXT_BAR_CACHE_TTL_MIN'))
  return n > 0 ? n * 60000 : undefined
}


// `full` counts each tool and file like /context does; `summary` is a free local estimate.
const breakdownOf = async ($: EngineInterface, detail: 'summary' | 'full' = 'summary') =>
  (await $.session.usage({ breakdown: detail })).context.breakdown

// CONTEXT_BAR_MAX_TOKENS sets the message budget; absent, 100% is the engine's window.
const budgetOf = async ($: EngineInterface) => {
  const n = Number(await $.env.get('CONTEXT_BAR_MAX_TOKENS'))
  return n > 0 ? n : undefined
}

const refresh = async ($: EngineInterface) => {
  const b = await breakdownOf($)
  if (!b) return
  const snap = measure(b, await budgetOf($))
  await update($, snapshot, () => snap)
}

const lines = async ($: EngineInterface, b: SessionContextBreakdown, withTools: boolean) => {
  const out: Line[] = []
  for (const f of b.memoryFiles) {
    out.push({ category: 'Memory files', kind: 'file', name: f.path, tokens: f.tokens, note: f.type })
  }
  const servers = new Map<string, typeof b.mcpTools>()
  for (const t of b.mcpTools) servers.set(t.serverName, [...(servers.get(t.serverName) ?? []), t])
  for (const [server, tools] of servers) {
    const loaded = tools.filter(t => t.isLoaded)
    out.push({
      category: 'MCP tools',
      kind: 'mcp',
      name: server,
      tokens: loaded.reduce((a, t) => a + t.tokens, 0),
      note: `${loaded.length}/${tools.length} tools in window`,
    })
    if (withTools) {
      for (const t of loaded) {
        out.push({ category: 'MCP tools', kind: 'tool', name: t.name, tokens: t.tokens, note: server })
      }
    }
  }
  for (const s of b.skills?.skillFrontmatter ?? []) {
    out.push({ category: 'Skills', kind: 'skill', name: s.name, tokens: s.tokens, note: s.pluginName ?? s.source })
  }
  if (b.slashCommands) {
    const c = b.slashCommands
    out.push({
      category: 'Skills',
      kind: 'cmds',
      name: 'slash-command listing',
      tokens: c.tokens,
      note: `${c.includedCommands}/${c.totalCommands}`,
    })
  }
  for (const a of b.agents) {
    out.push({ category: 'Custom agents', kind: 'agent', name: a.agentType, tokens: a.tokens, note: a.source })
  }
  // The next two are chars/4 estimates, not counted tokens.
  for (const s of (await $.prompt.compose()).sections) {
    out.push({ category: 'System prompt', kind: 'prompt', name: s.id, tokens: Math.round(s.text.length / 4), note: s.scope })
  }
  for (const t of await $.tool.list()) {
    if (t.mcp) continue
    out.push({
      category: 'System tools',
      kind: 'tool',
      name: t.name,
      tokens: Math.round(t.description.length / 4),
      note: '~ description',
    })
  }
  return out.sort((a, b) => b.tokens - a.tokens)
}


const show = async ($: EngineInterface, category: string) => {
  const b = await breakdownOf($, 'full')
  const all = b ? await lines($, b, true) : []
  const used = (await read($, snapshot))?.rows.filter(r => r.kind === 'used') ?? []
  const tabs = bySize(used.map(r => ({ name: r.name, tokens: r.tokens, colour: colourOf(used, r) })))
  // Every category's lines are kept, so switching tabs needs no new count.
  await update($, detail, () => ({ category, lines: all, tabs }))
  await $.ui.open({ id: PANE, title: category, focus: true, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-bar', description: 'Toggle the context window bar above the prompt' })
    await $.command.register({
      name: 'context-lines',
      description: 'Rank what fills the context window: files, MCP servers, skills, agents, prompt sections',
      argumentHint: '[top N, default 40] [all]',
    })
    void refresh($)
    // The cache countdown moves with the clock, not with any event: redraw each minute.
    $.clock.every(60000, async () => {
      const s = await read($, stats)
      if (s.lastAt !== undefined || s.compactedAt !== undefined) await update($, tick, n => n + 1)
    })
    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    const now = !(await read($, isOn))
    await update($, isOn, () => now)
    if (now) await refresh($)
    return { text: now ? 'Context bar on.' : 'Context bar off.' }
  })

  on('command.run', { command: 'context-lines' }, async ($, e) => {
    const args = e.args ?? ''
    const top = Number(args.match(/\d+/)?.[0] ?? 40)
    const withTools = /\ball\b/.test(args)
    const b = await breakdownOf($, 'full')
    if (!b) return { text: 'context-lines: no breakdown available (no session bound).' }
    const all = await lines($, b, withTools)
    const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0)
    const deferred = b.categories.find(c => c.kind === 'deferred')
    const shown = all.slice(0, top)
    const w = Math.min(60, Math.max(10, ...shown.map(l => l.name.length)))
    const m = measure(b, await budgetOf($))
    const out = [
      `Context: ${kTokens(m.usedTokens)} of ${kTokens(m.max)} (${Math.round(m.percent)}%)`,
      used.map(c => `${c.name} ${kTokens(c.tokens)}`).join(' | '),
      deferred ? `Deferred (outside the window, loaded on demand): ${kTokens(deferred.tokens)}` : '',
      `Top ${Math.min(top, all.length)} of ${all.length} lines by tokens:`,
      ...shown.map(l => `${lpad(kTokens(l.tokens), 7)}  ${pad(l.name, w)}  ${l.note}`),
      'Cut: /mcp to disable a server; /plugin to disable a plugin and its skills; CLAUDE.md and memory files by path above.',
      'Pass "all" to list each MCP tool schema on its own line. In the Details view, click a category for its lines.',
    ]
    return { text: out.filter(Boolean).join('\n') }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Busy time and turns count the main conversation only, not subagents running inside it.
    if (e.agentId === undefined) {
      const turns = await $.session.turns()
      const lastAt = await $.clock.now()
      await update($, stats, s => ({ ...s, busyMs: s.busyMs + e.durationMs, turns, lastAt, compactedAt: undefined }))
    }
    if (await read($, isOn)) void refresh($)
    return result
  })

  // Fires after each main turn and whenever a window moves a whole point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, stats, s => ({ ...s, limits: [...e.rateLimits] }))
    }
    return next(e)
  })

  // A compaction of the main conversation leaves nothing the cache holds: cold until the next main turn.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      const compactedAt = await $.clock.now()
      await update($, stats, s => ({ ...s, compactedAt }))
      if (await read($, isOn)) void refresh($)
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, stats, s => ({ ...s, busyMs: 0, turns: 0, lastAt: undefined, compactedAt: undefined }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const d = await read($, detail)
    const list = (d?.lines ?? []).filter(l => l.category === d?.category)
    const tabs = d?.tabs ?? []
    const tabText = (t: Tab) => ` ${shortName(t.name)} ${kTokens(t.tokens)}`
    // Tabs wrap: estimate their rows so the line items still fit below them.
    const cols = e.props.bodyColumns || e.viewport?.columns || 80
    const tabRows = wrappedRows(tabs.map(t => tabText(t).length + 4), cols)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 3 - tabRows)
    const shown = list.length > room ? list.slice(0, room - 1) : list
    const w = Math.min(50, Math.max(10, ...shown.map(l => l.name.length)))
    const total = list.reduce((a, l) => a + l.tokens, 0)
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{d?.category ?? ''}</Text>
          <Text dimColor>{`  ${list.length} lines, ${kTokens(total)} total  `}</Text>
          <Button key="close" label="Close" plain hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {tabs.length > 0 && (
          <Box key="tabs" flexWrap="wrap">
            {tabs.map(t => {
              const isOpen = t.name === d?.category
              const mark = isOpen ? '▶' : ' '
              const swatch = <Text key={`ts:${t.name}`} color={t.colour}>█</Text>
              const pick = () => update($, detail, x => x && { ...x, category: t.name })
              return (
                <Box key={`tb:${t.name}`} marginRight={2}>
                  {e.surface === 'terminal' ? (
                    <Button key={`tab:${t.name}`} plain dimColor={!isOpen} onPress={pick}>
                      {mark}
                      {swatch}
                      {tabText(t)}
                    </Button>
                  ) : (
                    [
                      swatch,
                      <Button key={`tab:${t.name}`} plain dimColor={!isOpen} onPress={pick}>
                        {`${mark}${tabText(t)}`}
                      </Button>,
                    ]
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        {list.length === 0 && <Text dimColor>Nothing itemised for this row.</Text>}
        {shown.map((l, i) => (
          <Text key={`l${i}`}>
            {`${lpad(kTokens(l.tokens), 7)}  ${pad(l.name.slice(0, w), w)}  `}
            <Text dimColor>{l.note}</Text>
          </Text>
        ))}
        {shown.length < list.length && (
          <Text dimColor>{`+${list.length - shown.length} more: /context-lines all`}</Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || !snap || !(await read($, isOn))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    await read($, tick)
    const b = band({
      snapshot: snap,
      stats: await read($, stats),
      compact: await read($, compact),
      now: await $.clock.now(),
      ttlMs: await ttlOf($),
      columns: e.props.bodyColumns || e.viewport?.columns || 80,
    })
    const draw = (p: Part) =>
      p.colour ? (
        <Text key={p.id} color={p.colour}>{p.text}</Text>
      ) : p.dim ? (
        <Text key={p.id} dimColor>{p.text}</Text>
      ) : (
        <Text key={p.id}>{p.text}</Text>
      )
    const box = (key: string, title: string, parts: Part[]) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Text bold>{title}</Text>
        {parts.map(draw)}
      </Box>
    )

    if (b.view === 'compact') {
      return (
        <Box key="compact-line">
          <Text>{b.line.map(draw)}</Text>
          <Button key="details" label={b.details} plain dimColor onPress={() => update($, compact, () => false)} />
        </Box>
      )
    }

    return (
      <Box key="detail-view" flexDirection="column">
        <Text>{b.bar.map(draw)}</Text>
        <Box key="boxes" flexWrap="wrap">
          {b.context.length > 0 && (
            <Box key="context" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text bold>Context</Text>
              <Box key="cells" flexWrap="wrap">
                {b.context.map((col, c, all) => (
                  <Box key={`col${c}`} flexDirection="column" marginRight={c < all.length - 1 ? 2 : 0}>
                    {col.map(cell => {
                      const swatch = <Text key={`sw:${cell.category}`} color={cell.swatch}>█</Text>
                      const open = () => show($, cell.category)
                      // A desktop's native button drops the colour of text inside it.
                      return e.surface === 'terminal' ? (
                        <Button key={`cat:${cell.category}`} plain dimColor onPress={open}>
                          {swatch}
                          {cell.text}
                        </Button>
                      ) : (
                        <Box key={`cell:${cell.category}`}>
                          {swatch}
                          <Button key={`cat:${cell.category}`} plain dimColor onPress={open}>
                            {cell.text}
                          </Button>
                        </Box>
                      )
                    })}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {b.limits.length > 0 && box('limits', 'Limits', b.limits)}
          {b.busy && box('busy', 'Busy time', b.busy)}
          {b.cache && box('cache', 'Cache', b.cache)}
        </Box>
        <Button key="compact" label="[Compact]" plain dimColor onPress={() => update($, compact, () => true)} />
      </Box>
    )
  })
}
