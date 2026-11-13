import { expect, test } from 'claude-code/testing'

import { agentTime, isTestCommand, limitsLabel, testsFrom, testsLabel } from './stats'

test('test commands are spotted, other commands are not', async () => {
  expect(isTestCommand('npx vitest run src/x.test.ts')).toBe(true)
  expect(isTestCommand('python3 -m pytest tests/test_a.py -q')).toBe(true)
  expect(isTestCommand('bash .claude/skills/test-backend/run.sh tests/test_a.py')).toBe(true)
  expect(isTestCommand('claude plugin test .')).toBe(true)
  expect(isTestCommand('git status')).toBe(false)
})

test('a test run reads as passed or failed with its counts', async () => {
  expect(testsFrom(false, '==== 58 passed in 3.1s ====')).toEqual({ state: 'pass', passed: 58, failed: undefined })
  expect(testsFrom(true, ' 2 fail\n 9 pass')).toEqual({ state: 'fail', passed: 9, failed: 2 })
  expect(testsLabel({ state: 'pass', passed: 58 })).toBe('58 passed')
  expect(testsLabel({ state: 'fail', failed: 2 })).toBe('2 failed')
  expect(testsLabel({ state: 'stale', passed: 58 })).toBe('stale')
  expect(testsLabel({ state: 'none' })).toBe('not run')
})

test('rate limits and agent time read short', async () => {
  expect(limitsLabel([{ kind: 'five_hour', percentUsed: 38 }, { kind: 'seven_day', percentUsed: 61.5 }])).toBe('5h 38% · 7d 62%')
  expect(limitsLabel([])).toBe('')
  expect(agentTime(3134000)).toBe('52m 14s')
  expect(agentTime(45000)).toBe('45s')
  expect(agentTime(3 * 3600000 + 5 * 60000)).toBe('3h 5m')
})
