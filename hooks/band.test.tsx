import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

// Sat 14 Nov 2026, 10:00 local time.
const NOW = new Date(2026, 10, 14, 10, 0).getTime()
const MIN = 60000
const at = (ms: number) => new Date(NOW + ms).toISOString()

const band = (columns: number) =>
  ({
    plugin: 'context-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 12,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
    viewport: { columns: columns + 5, rows: 40 },
  }) as const

const usage = (messages: number) => ({
  window: 200000,
  context: {
    window: 200000,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 8000, kind: 'used', color: 'promptBorder', isDeferred: false },
        { name: 'Messages', tokens: messages, kind: 'used', color: 'inactive', isDeferred: false },
        { name: 'Free space', tokens: 192000 - messages, kind: 'free', color: 'inactive', isDeferred: false },
      ],
      totalTokens: 8000 + messages,
      maxTokens: 200000,
      rawMaxTokens: 200000,
      percentage: ((8000 + messages) / 200000) * 100,
      memoryFiles: [],
      mcpTools: [],
      agents: [],
    },
  },
})

// Stands in for the engine beneath the mod, then starts a session at NOW.
const start = async ($: Engine, on: On, opts: { cap?: string; messages?: number; hooks?: (on: On) => void } = {}) => {
  opts.hooks?.(on)
  const clock = mock.clock(on, { now: NOW })
  on('env.get', () => ({ value: opts.cap }) as never)
  on('session.usage', () => ({ value: usage(opts.messages ?? 60000) }) as never)
  on('session.turns', () => ({ value: 33 }) as never)
  on('command.register', (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  return clock
}

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: { window: 200000 }, rateLimits, changed: ['rateLimits'] })

const turn = ($: Engine, durationMs: number, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs, isAborted: false, turnId: `t${durationMs}`, reason: 'answer', agentId })

const LIMITS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 38, resetsAt: at(100 * MIN) },
  { kind: 'seven_day', percentUsed: 61.5, resetsAt: new Date(2026, 10, 19, 9, 30).toISOString() },
  { kind: 'spend_limit', percentUsed: 99 },
]

const barCells = (text: string) => (text.match(/[█▌░▒]/g) ?? []).length

test('compact at 160 columns: bar, percent, both windows, busy time, turns and Details on one line', async ($, on) => {
  await start($, on)
  await measure($, LIMITS)
  await turn($, 3134000)

  const ui = await $.ui.mount(band(160))
  const line = (await ui.find({ key: 'compact-line' }))!.text
  expect(line).toContain(' 34% of 200.0k  5h ▰▰▱▱▱ 38%  wk ▰▰▰▱▱ 62%  busy 52m 14s · 33 turns  [Details]')
  expect(line).not.toContain('99%')
  expect(line).not.toContain('↻')
  // The bar takes every cell the band leaves over.
  expect(barCells(line)).toBe(160 - ' 34% of 200.0k  5h ▰▰▱▱▱ 38%  wk ▰▰▰▱▱ 62%  busy 52m 14s · 33 turns  [Details]'.length)
  // Under 70% the windows and the percent label stay quiet.
  expect((await ui.find({ type: 'Text', text: /^5h ▰▰▱▱▱ 38%$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^ 34% of 200.0k$/ }))?.props.color).toBeUndefined()
  // No legend in compact view.
  expect(await ui.find({ type: 'Button', text: /Messages/ })).toBeUndefined()
  await ui.unmount()
})

test('compact at 80 columns drops turns, then busy time, and keeps the bar at 20 cells or more', async ($, on) => {
  await start($, on)
  await measure($, LIMITS)
  await turn($, 3134000)

  const ui = await $.ui.mount(band(80))
  const line = (await ui.find({ key: 'compact-line' }))!.text
  expect(line).toContain(' 34% of 200.0k  5h ▰▰▱▱▱ 38%  wk ▰▰▰▱▱ 62%  [Details]')
  expect(line).not.toContain('busy')
  expect(line).not.toContain('turns')
  expect(barCells(line)).toBe(27)
  await ui.unmount()

  const narrow = await $.ui.mount(band(60))
  const short = (await narrow.find({ key: 'compact-line' }))!.text
  expect(short).toContain('5h ▰▰▱▱▱ 38%')
  expect(short).not.toContain('wk')
  expect(barCells(short)).toBeGreaterThanOrEqual(20)
  await narrow.unmount()

  const tiny = await $.ui.mount(band(30))
  const none = (await tiny.find({ key: 'compact-line' }))!.text
  expect(none).not.toContain('5h')
  expect(barCells(none)).toBe(20)
  await tiny.unmount()
})

test('windows turn yellow at 70%, pink at 90%, and show when they reset', async ($, on) => {
  const clock = await start($, on)
  await measure($, [
    { kind: 'five_hour', percentUsed: 92, resetsAt: at(100 * MIN) },
    { kind: 'seven_day', percentUsed: 75, resetsAt: new Date(2026, 10, 19, 9, 30).toISOString() },
  ])

  const ui = await $.ui.mount(band(160))
  const fiveH = await ui.find({ type: 'Text', text: /^5h / })
  expect(fiveH?.text).toBe('5h ▰▰▰▰▰ 92% ↻ 1h 40m')
  expect(fiveH?.props.color).toBe('#FF498E')
  const week = await ui.find({ type: 'Text', text: /^wk / })
  expect(week?.text).toBe('wk ▰▰▰▰▱ 75% ↻ Thu 9:30')
  expect(week?.props.color).toBe('#FFDB35')

  // The countdown reads "now" from the clock.
  await clock.advance(10 * MIN)
  await ui.redraw()
  expect((await ui.find({ type: 'Text', text: /^5h / }))?.text).toBe('5h ▰▰▰▰▰ 92% ↻ 1h 30m')
  await ui.unmount()
})

test('the percent label warns at the same thresholds as the windows', async ($, on) => {
  await start($, on, { messages: 136000 }) // 144k of 200k = 72%

  const ui = await $.ui.mount(band(160))
  expect((await ui.find({ type: 'Text', text: /^ 72% of 200.0k$/ }))?.props.color).toBe('#FFDB35')
  await ui.unmount()
})

test('a window with no reset time shows none', async ($, on) => {
  await start($, on)
  await measure($, [{ kind: 'five_hour', percentUsed: 95 }])

  const ui = await $.ui.mount(band(160))
  expect((await ui.find({ type: 'Text', text: /^5h / }))?.text).toBe('5h ▰▰▰▰▰ 95%')
  await ui.unmount()
})

test('off a subscription, or with only a spend limit, the limits are hidden', async ($, on) => {
  await start($, on)
  await turn($, 45000)

  const ui = await $.ui.mount(band(160))
  expect((await ui.find({ key: 'compact-line' }))!.text).toContain(' 34% of 200.0k  busy 45s · 33 turns  [Details]')
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Text', text: 'Limits' })).toBeUndefined()
  await ui.unmount()

  await measure($, [{ kind: 'spend_limit', percentUsed: 40 }])
  const again = await $.ui.mount(band(160))
  expect(await again.find({ type: 'Text', text: 'Limits' })).toBeUndefined()
  await again.unmount()
})

test('Details shows the legend and labelled boxes; Compact switches back, and the choice sticks', async ($, on) => {
  await start($, on)
  await measure($, LIMITS)
  await turn($, 3 * 3600000 + 5 * MIN)

  const ui = await $.ui.mount(band(160))
  await ui.press({ key: 'details' })
  expect(await ui.find({ key: 'compact-line' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Messages 60.0k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Limits' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^5-hour / }))?.text).toBe('5-hour ▰▰▱▱▱ 38%')
  expect((await ui.find({ type: 'Text', text: /^Weekly / }))?.text).toBe('Weekly ▰▰▰▱▱ 62%')
  expect(await ui.find({ type: 'Text', text: 'Busy time' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3h 5m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '33 turns' })).toBeDefined()
  // The detail bar fills the row beside the percent label, as before.
  const barLine = await ui.find({ type: 'Text', text: / 34% of 200.0k$/ })
  expect(barCells(barLine!.text)).toBe(160 - ' 34% of 200.0k'.length - 1)

  // The choice holds across redraws and new mounts for the session.
  await ui.redraw()
  expect(await ui.find({ key: 'detail-view' })).toBeDefined()
  await ui.unmount()
  const later = await $.ui.mount(band(80))
  expect(await later.find({ key: 'detail-view' })).toBeDefined()

  await later.press({ key: 'compact' })
  expect(await later.find({ key: 'compact-line' })).toBeDefined()
  expect(await later.find({ type: 'Button', text: /Messages/ })).toBeUndefined()
  await later.unmount()
})

test('a legend entry in the detail view still opens its category', async ($, on) => {
  let opened = ''
  await start($, on, {
    hooks: on => {
      on('ui.open', (_, e) => {
        opened = e.title ?? ''
        return { value: { isPlaced: true } } as never
      })
      on('prompt.compose', () => ({ sections: [] }) as never)
      on('tool.list', () => ({ value: [] }) as never)
    },
  })

  const ui = await $.ui.mount(band(160))
  await ui.press({ key: 'details' })
  await ui.press({ key: 'b1' })
  expect(opened).toBe('Messages')
  await ui.unmount()
})

test('busy time counts main turns only, and /clear resets busy time and turns', async ($, on) => {
  await start($, on)
  await turn($, 45000)
  await turn($, 600000, 'agent-1')

  const ui = await $.ui.mount(band(160))
  expect((await ui.find({ key: 'compact-line' }))!.text).toContain('busy 45s · 33 turns')
  await ui.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  const cleared = await $.ui.mount(band(160))
  const line = (await cleared.find({ key: 'compact-line' }))!.text
  expect(line).not.toContain('busy')
  expect(line).not.toContain('turns')
  await cleared.unmount()
})

test('/context-bar hides the band along with the bar', async ($, on) => {
  await start($, on, {
    hooks: on =>
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      }),
  })
  await measure($, LIMITS)
  const run = () =>
    $.command.run({ command: 'context-bar', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } })

  expect((await run()).text).toBe('Context bar off.')
  const off = await $.ui.mount(band(160))
  expect(await off.find({ key: 'compact-line' })).toBeUndefined()
  expect(await off.find({ type: 'Text', text: /5h/ })).toBeUndefined()
  await off.unmount()

  expect((await run()).text).toBe('Context bar on.')
  const on2 = await $.ui.mount(band(160))
  expect((await on2.find({ key: 'compact-line' }))!.text).toContain('5h ▰▰▱▱▱ 38%')
  await on2.unmount()
})

test('CONTEXT_BAR_MAX_TOKENS still sets what 100% means in the band', async ($, on) => {
  await start($, on, { cap: '120000' })
  const ui = await $.ui.mount(band(160))
  // 68k used against 8k up front + 120k of messages.
  expect((await ui.find({ key: 'compact-line' }))!.text).toContain(' 53% of 128.0k')
  await ui.unmount()
})

test('used segments are split by a thin gap, and the last one runs into free space', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(band(160))
  const segments = await ui.findAll({ type: 'Text', text: /^[█▌]+$/ })
  expect(segments.map(t => t.text.endsWith('▌'))).toEqual([true, false])
  expect(segments[0]!.props.color).toBe('#6F02E4')
  await ui.unmount()
})
