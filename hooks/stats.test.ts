import { expect, test } from 'claude-code/testing'

import { agentTime, fit, level, levelColour, meter, resetLabel, segment, turnsLabel, windowLabel, windowsOf } from './stats'

const NOW = new Date(2026, 10, 14, 10, 0).getTime() // Sat 14 Nov 2026, 10:00 local
const inMs = (ms: number) => new Date(NOW + ms).toISOString()

test('a meter has 5 cells filled by percent', async () => {
  expect(meter(0)).toBe('▱▱▱▱▱')
  expect(meter(38)).toBe('▰▰▱▱▱')
  expect(meter(61.5)).toBe('▰▰▰▱▱')
  expect(meter(100)).toBe('▰▰▰▰▰')
  expect(meter(130)).toBe('▰▰▰▰▰')
})

test('fullness turns yellow at 70 and pink at 90', async () => {
  for (const [p, l] of [[69.9, 'normal'], [70, 'warn'], [89.9, 'warn'], [90, 'critical']] as const) {
    expect(level(p)).toBe(l)
  }
  expect(levelColour('normal')).toBeUndefined()
  expect(levelColour('warn')).toBe('#FFDB35')
  expect(levelColour('critical')).toBe('#FF498E')
})

test('only the 5-hour and weekly windows show, 5-hour first', async () => {
  const limits = [
    { kind: 'spend_limit', percentUsed: 95 },
    { kind: 'seven_day', percentUsed: 61.5 },
    { kind: 'five_hour', percentUsed: 38 },
  ]
  expect(windowsOf(limits).map(l => l.kind)).toEqual(['five_hour', 'seven_day'])
  expect(windowsOf([{ kind: 'spend_limit', percentUsed: 20 }])).toEqual([])
  expect(windowsOf([])).toEqual([])
})

test('reset labels: countdown for 5h, local weekday for weekly, none under 70%', async () => {
  const hour = 3600000
  expect(resetLabel({ kind: 'five_hour', percentUsed: 75, resetsAt: inMs(hour + 40 * 60000) }, NOW)).toBe('↻ 1h 40m')
  expect(resetLabel({ kind: 'five_hour', percentUsed: 92, resetsAt: inMs(12 * 60000) }, NOW)).toBe('↻ 12m')
  expect(resetLabel({ kind: 'five_hour', percentUsed: 92, resetsAt: inMs(-60000) }, NOW)).toBeUndefined()
  const thu = new Date(2026, 10, 19, 9, 30).toISOString()
  expect(resetLabel({ kind: 'seven_day', percentUsed: 70, resetsAt: thu }, NOW)).toBe('↻ Thu 9:30')
  expect(resetLabel({ kind: 'seven_day', percentUsed: 69.9, resetsAt: thu }, NOW)).toBeUndefined()
  expect(resetLabel({ kind: 'five_hour', percentUsed: 95 }, NOW)).toBeUndefined()
  expect(resetLabel({ kind: 'five_hour', percentUsed: 95, resetsAt: 'soon' }, NOW)).toBeUndefined()
})

test('a window reads short in compact view and in full in detail', async () => {
  const fiveH = { kind: 'five_hour', percentUsed: 38, resetsAt: inMs(3600000) }
  expect(windowLabel(fiveH, NOW, true)).toBe('5h ▰▰▱▱▱ 38%')
  expect(windowLabel({ ...fiveH, percentUsed: 80 }, NOW, false)).toBe('5-hour ▰▰▰▰▱ 80% ↻ 1h 0m')
  expect(windowLabel({ kind: 'seven_day', percentUsed: 61.5 }, NOW, true)).toBe('wk ▰▰▰▱▱ 62%')
})

test('busy time and turns read short', async () => {
  expect(agentTime(3134000)).toBe('52m 14s')
  expect(agentTime(45000)).toBe('45s')
  expect(agentTime(3 * 3600000 + 5 * 60000)).toBe('3h 5m')
  expect(turnsLabel(1)).toBe('1 turn')
  expect(turnsLabel(33)).toBe('33 turns')
})

test('a narrow line drops turns, then busy time, then weekly, then 5h', async () => {
  const pieces = [
    { id: 'turns', width: 10 },
    { id: 'busy', width: 14 },
    { id: 'wk', width: 14 },
    { id: '5h', width: 14 },
  ]
  // fixed 25: percent label and the Details button
  expect(fit(160, 25, pieces)).toEqual({ keep: ['turns', 'busy', 'wk', '5h'], bar: 83 })
  expect(fit(97, 25, pieces)).toEqual({ keep: ['turns', 'busy', 'wk', '5h'], bar: 20 })
  expect(fit(96, 25, pieces)).toEqual({ keep: ['busy', 'wk', '5h'], bar: 29 })
  expect(fit(80, 25, pieces)).toEqual({ keep: ['wk', '5h'], bar: 27 })
  expect(fit(70, 25, pieces)).toEqual({ keep: ['5h'], bar: 31 })
  expect(fit(50, 25, pieces)).toEqual({ keep: [], bar: 25 })
  expect(fit(30, 25, pieces)).toEqual({ keep: [], bar: 20 })
})

test('a segment that meets another ends in a half block', async () => {
  expect(segment(4, true)).toBe('███▌')
  expect(segment(4, false)).toBe('████')
  expect(segment(1, true)).toBe('▌')
  expect(segment(0, true)).toBe('')
})
