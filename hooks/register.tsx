import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

import type { Line, Row, Stats, Tab } from '../types'
import { bySize, colourOf, columnsOf, kTokens, lpad, pad, shortName, wrappedRows } from './categories'
import { agentTime, CACHE_TTL_MIN, cacheLabel, cacheOf, fit, level, levelColour, segment, span, turnsLabel, windowLabel, windowsOf } from './stats'
import type { Piece } from './stats'

const PANE = 'context-lines'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)
const detail = atom({ plugin: 'context-bar', key: 'detail' } as const, null)
const NO_STATS: Stats = { turns: 0, busyMs: 0, limits: [] }
const stats = atom({ plugin: 'context-bar', key: 'stats' } as const, NO_STATS)
const compact = atom({ plugin: 'context-bar', key: 'compact' } as const, true)
const tick = atom({ plugin: 'context-bar', key: 'tick' } as const, 0)

const ttlOf = async ($: EngineInterface) => {
  const n = Number(await $.env.get('CONTEXT_BAR_CACHE_TTL_MIN'))
  return (n > 0 ? n : CACHE_TTL_MIN) * 60000
}


// Largest-remainder split: the cells always add up to exactly `width`.
const cells = (rows: Row[], max: number, width: number) => {
  const exact = rows.map(r => (max > 0 ? (r.tokens / max) * width : 0))
  const out = exact.map(Math.floor)
  let left = width - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (let j = 0; left > 0 && order.length > 0; j = (j + 1) % order.length, left--) {
    const i = order[j]![1]
    out[i] = out[i]! + 1
  }
  return out
}

// `full` counts each tool and file like /context does; `summary` is a free local estimate.
const breakdownOf = async ($: EngineInterface, detail: 'summary' | 'full' = 'summary') =>
  (await $.session.usage({ breakdown: detail })).context.breakdown

// CONTEXT_BAR_MAX_TOKENS is the budget for Messages: 100% is whatever loads up front
// (system prompt, tools, memory, skills...) plus that many message tokens.
const capOf = async ($: EngineInterface, b: SessionContextBreakdown) => {
  const n = Number(await $.env.get('CONTEXT_BAR_MAX_TOKENS'))
  if (!(n > 0)) return b.rawMaxTokens
  const base = b.categories
    .filter(c => c.kind === 'used' && c.name !== 'Messages')
    .reduce((a, c) => a + c.tokens, 0)
  return base + n
}

const refresh = async ($: EngineInterface) => {
  const b = await breakdownOf($)
  if (!b) return
  let rows: Row[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind as Row['kind'] }))
  const max = await capOf($, b)
  if (max === b.rawMaxTokens) {
    await update($, snapshot, () => ({ rows, max, percent: b.percentage }))
    return
  }
  // Capped: drop the engine's free/buffer rows and refill free space up to the cap.
  const used = rows.filter(r => r.kind === 'used')
  const total = used.reduce((a, r) => a + r.tokens, 0)
  rows = [...used, { name: 'Free space', tokens: Math.max(0, max - total), kind: 'free' }]
  await update($, snapshot, () => ({ rows, max, percent: (total / max) * 100 }))
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
    const max = await capOf($, b)
    const percent = max === b.rawMaxTokens ? b.percentage : (b.totalTokens / max) * 100
    const out = [
      `Context: ${kTokens(b.totalTokens)} of ${kTokens(max)} (${Math.round(percent)}%)`,
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
    const s = await read($, stats)
    const isCompact = await read($, compact)
    await read($, tick)
    const now = await $.clock.now()
    const cache = cacheOf(s, now, await ttlOf($))
    const cacheText = (key: string, text: string) =>
      cache?.colour ? <Text key={key} color={cache.colour}>{text}</Text> : <Text key={key} dimColor>{text}</Text>
    const columns = e.props.bodyColumns || e.viewport?.columns || 80
    const label = ` ${Math.round(snap.percent)}% of ${kTokens(snap.max)}`
    const labelColour = levelColour(level(snap.percent))
    const windows = windowsOf(s.limits)
    const hasBusy = s.turns > 0 || s.busyMs > 0
    const used = snap.rows.filter(r => r.kind === 'used')
    // What the next request sends again: everything in the window now.
    const recache = used.reduce((a, r) => a + r.tokens, 0)
    const colour = (r: Row) => colourOf(used, r)

    const bar = (width: number) => {
      // Over the cap the used rows fill the whole bar instead of overflowing it.
      const widths = cells(snap.rows, Math.max(snap.max, snap.rows.reduce((a, r) => a + r.tokens, 0)), width)
      // A used segment that meets another used one ends in a half block, leaving a thin gap.
      const nextShown = (i: number) => snap.rows.find((_, j) => j > i && (widths[j] ?? 0) > 0)
      return snap.rows.map((r, i) =>
        r.kind === 'used' ? (
          <Text key={`s${i}`} color={colour(r)}>{segment(widths[i] ?? 0, nextShown(i)?.kind === 'used')}</Text>
        ) : (
          <Text key={`s${i}`} dimColor>{(r.kind === 'free' ? '░' : '▒').repeat(widths[i] ?? 0)}</Text>
        ),
      )
    }
    const percent = labelColour ? <Text key="pct" color={labelColour}>{label}</Text> : <Text key="pct">{label}</Text>
    const windowText = (key: string, l: (typeof windows)[number], short: boolean) => {
      const c = levelColour(level(l.percentUsed))
      const text = windowLabel(l, now, short)
      return c ? <Text key={key} color={c}>{text}</Text> : <Text key={key} dimColor>{text}</Text>
    }

    if (isCompact) {
      const GAP = '  '
      const details = '[Details]'
      const busy = `${GAP}busy ${agentTime(s.busyMs)}`
      const turns = ` · ${turnsLabel(s.turns)}`
      const cacheLine = cache && `${GAP}${cacheLabel(cache)}`
      // In drop order: turns, busy time, weekly window, cache, 5-hour window.
      const [fiveHour, weekly] = [windows.filter(l => l.kind === 'five_hour'), windows.filter(l => l.kind !== 'five_hour')]
      const windowPiece = (l: (typeof windows)[number]) => ({ id: l.kind, width: GAP.length + windowLabel(l, now, true).length })
      const pieces: Piece[] = [
        ...(hasBusy ? [{ id: 'turns', width: turns.length }, { id: 'busy', width: busy.length }] : []),
        ...weekly.map(windowPiece),
        ...(cacheLine ? [{ id: 'cache', width: cacheLine.length }] : []),
        ...fiveHour.map(windowPiece),
      ]
      const { keep, bar: barWidth } = fit(columns, label.length + GAP.length + details.length, pieces)
      return (
        <Box key="compact-line">
          <Text>
            {bar(barWidth)}
            {percent}
            {windows
              .filter(l => keep.includes(l.kind))
              .flatMap(l => [<Text key={`g${l.kind}`}>{GAP}</Text>, windowText(`w${l.kind}`, l, true)])}
            {keep.includes('busy') && <Text key="busy" dimColor>{busy}</Text>}
            {keep.includes('turns') && <Text key="turns" dimColor>{turns}</Text>}
            {cacheLine && keep.includes('cache') && cacheText('cache', cacheLine)}
            {GAP}
          </Text>
          <Button key="details" label={details} plain dimColor onPress={() => update($, compact, () => false)} />
        </Box>
      )
    }

    return (
      <Box key="detail-view" flexDirection="column">
        <Text>
          {bar(Math.max(20, columns - label.length - 1))}
          {percent}
        </Text>
        <Box key="boxes" flexWrap="wrap">
          {used.length > 0 && (
            <Box key="context" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text bold>Context</Text>
              <Box key="cells" flexWrap="wrap">
                {columnsOf(used).map((col, c, all) => {
                  const nameW = Math.max(...col.map(r => shortName(r.name).length))
                  const tokW = Math.max(...col.map(r => kTokens(r.tokens).length))
                  return (
                    <Box key={`col${c}`} flexDirection="column" marginRight={c < all.length - 1 ? 2 : 0}>
                      {col.map(r => {
                        const swatch = <Text key={`sw:${r.name}`} color={colour(r)}>█</Text>
                        const text = ` ${pad(shortName(r.name), nameW)} ${lpad(kTokens(r.tokens), tokW)}`
                        const open = () => show($, r.name)
                        // A desktop's native button drops the colour of text inside it.
                        return e.surface === 'terminal' ? (
                          <Button key={`cat:${r.name}`} plain dimColor onPress={open}>
                            {swatch}
                            {text}
                          </Button>
                        ) : (
                          <Box key={`cell:${r.name}`}>
                            {swatch}
                            <Button key={`cat:${r.name}`} plain dimColor onPress={open}>
                              {text}
                            </Button>
                          </Box>
                        )
                      })}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          )}
          {windows.length > 0 && (
            <Box key="limits" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text bold>Limits</Text>
              {windows.map(l => windowText(`d${l.kind}`, l, false))}
            </Box>
          )}
          {hasBusy && (
            <Box key="busy" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text bold>Busy time</Text>
              <Text dimColor>{agentTime(s.busyMs)}</Text>
              <Text dimColor>{turnsLabel(s.turns)}</Text>
            </Box>
          )}
          {cache && (
            <Box key="cache" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Text bold>Cache</Text>
              {cacheText(
                'cache-state',
                cache.isWarm ? `warm, ${span(cache.leftMs + 59999)} left` : cache.reason === 'compacted' ? 'cold, compacted' : 'cold',
              )}
              <Text dimColor>{`idle ${span(cache.idleMs)}`}</Text>
              {!cache.isWarm && <Text key="recache" dimColor>{`next message re-caches ~${kTokens(recache)}`}</Text>}
            </Box>
          )}
        </Box>
        <Button key="compact" label="[Compact]" plain dimColor onPress={() => update($, compact, () => true)} />
      </Box>
    )
  })
}
