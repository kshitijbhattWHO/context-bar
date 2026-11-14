import { expect, test } from 'claude-code/testing'

import { columnsOf, shortName, wrappedRows } from './categories'

test('long category names get a short label; others stay as they are', async () => {
  expect(shortName('System prompt')).toBe('Prompt')
  expect(shortName('System tools')).toBe('Tools')
  expect(shortName('MCP server instructions')).toBe('MCP')
  expect(shortName('Memory files')).toBe('Memory')
  expect(shortName('Skills')).toBe('Skills')
  expect(shortName('Custom agents')).toBe('Custom agents')
})

test('cells fill 2 rows, largest first, down each column', async () => {
  const of = (...t: number[]) => t.map((tokens, i) => ({ name: `c${i}`, tokens }))
  const names = (cols: { name: string }[][]) => cols.map(c => c.map(x => x.name))
  expect(names(columnsOf(of(10, 50, 30, 20, 60, 40)))).toEqual([['c4', 'c1'], ['c5', 'c2'], ['c3', 'c0']])
  expect(names(columnsOf(of(1, 2, 3)))).toEqual([['c2', 'c1'], ['c0']])
  expect(names(columnsOf(of(5)))).toEqual([['c0']])
  expect(columnsOf([])).toEqual([])
})

test('wrapped items move whole to the next row', async () => {
  expect(wrappedRows([], 40)).toBe(0)
  expect(wrappedRows([22, 22, 22, 22], 40)).toBe(4)
  expect(wrappedRows([20, 20, 20], 40)).toBe(2)
  expect(wrappedRows([50], 40)).toBe(1)
})
