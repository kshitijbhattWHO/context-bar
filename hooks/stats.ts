import type { SessionRateLimit } from 'claude-code'

import type { Tests } from '../types'

// Runner names, plus this machine's /test-backend script and `claude plugin test`.
const TEST_CMD =
  /\b(npm (run )?test|pnpm (run )?test|yarn test|bun test|npx (jest|vitest)|jest|vitest|pytest|go test|cargo test|node --test|make test|plugin test|test-backend)\b/

export const isTestCommand = (command: string) => TEST_CMD.test(command)

const count = (text: string, re: RegExp) => {
  const m = re.exec(text)
  return m ? Number(m[1]) : undefined
}

// Pass and fail counts from pytest, vitest/jest, bun and node --test output.
export const testsFrom = (isError: boolean, text: string): Tests => ({
  state: isError ? 'fail' : 'pass',
  passed: count(text, /(\d+) (?:passed|passing)\b/) ?? count(text, /(\d+) pass\b/),
  failed: count(text, /(\d+) (?:failed|failing)\b/) ?? count(text, /(\d+) fail\b/),
})

export const testsLabel = (t: Tests) =>
  t.state === 'pass'
    ? `${t.passed ?? ''} passed`.trim()
    : t.state === 'fail'
      ? `${t.failed ?? ''} failed`.trim()
      : t.state === 'stale'
        ? 'stale'
        : 'not run'

const SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const limitsLabel = (limits: SessionRateLimit[]) =>
  limits.map(l => `${SHORT[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%`).join(' · ')

export const agentTime = (ms: number) => {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}
