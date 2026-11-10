import { assert, test } from 'orca/testing'
import type { ChangeSpend, Spend } from './protocol'
import { formatMinutes, formatMoney, formatTokens, modelLabel, spendLine } from './spend-format'

const spend = (key: string, costUsd: number): Spend => ({
  key,
  runs: 1,
  costUsd,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  durationMs: 0,
  checkFailures: 0,
  escalated: 0
})

const change = (costs: [string, number][]): ChangeSpend => ({
  total: spend('total', costs.reduce((sum, [, cost]) => sum + cost, 0)),
  byModel: costs.map(([key, cost]) => spend(key, cost))
})

test('money shows two decimals, and a cent only from half a cent', () => {
  assert.equal(formatMoney(12.4), '$12.40')
  assert.equal(formatMoney(0.0051), '$0.01')
  assert.equal(formatMoney(0.005), '$0.01')
  assert.equal(formatMoney(0.0049), '<$0.01')
  assert.equal(formatMoney(0), '$0.00')
})

test('token counts are compact', () => {
  assert.equal(formatTokens(712), '712')
  assert.equal(formatTokens(58367), '58.4k')
  assert.equal(formatTokens(2000), '2k')
  assert.equal(formatTokens(999_990), '1M')
  assert.equal(formatTokens(1_200_000), '1.2M')
})

test('minutes and model labels', () => {
  assert.equal(formatMinutes(90_000), '1.5')
  assert.equal(modelLabel('claude-sonnet-5-5'), 'sonnet-5-5')
  assert.equal(modelLabel('gpt-x'), 'gpt-x')
})

test('the card line names at most three models, then how many more', () => {
  assert.equal(
    spendLine(change([['claude-sonnet-5-5', 7.1], ['claude-opus-5-1', 4.9], ['claude-haiku-5-5', 0.4]])),
    'Agent runs: $12.40 · sonnet-5-5 $7.10 · opus-5-1 $4.90 · haiku-5-5 $0.40'
  )
  assert.equal(
    spendLine(change([['a', 4], ['b', 3], ['c', 2], ['d', 1], ['e', 1]])),
    'Agent runs: $11.00 · a $4.00 · b $3.00 · c $2.00 · +2 more'
  )
})
