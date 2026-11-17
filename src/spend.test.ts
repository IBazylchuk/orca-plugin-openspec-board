import { assert, test } from 'orca/testing'
import { changeSpend, changeSpendDetail, MAX_RUN_LINES, parseRuns, spendHistory, taskOrder } from './spend'

const line = (fields: Record<string, unknown>): string => JSON.stringify(fields)

const SAMPLE = [
  line({
    at: '2026-01-10T18:56:50.228Z',
    agentType: 'Explore',
    task: '1.2',
    model: 'claude-haiku-5-5',
    inputTokens: 6,
    cacheWriteTokens: 33062,
    cacheReadTokens: 58367,
    outputTokens: 712,
    costUsd: 0.0051,
    durationMs: 11514,
    checkFailures: 0,
    isEscalated: false
  }),
  line({ at: '2026-01-12T08:00:00Z', agentType: 'main', task: '1.10', model: 'claude-sonnet-5-5', costUsd: 1.25, checkFailures: 2, isEscalated: true }),
  line({ at: '2026-02-03T08:00:00Z', agentType: 'main', model: 'claude-sonnet-5-5', costUsd: 0.75, outputTokens: 10 }),
  line({ model: 'claude-sonnet-5-5', costUsd: 0.5 })
].join('\n')

test('lines without a cost and without tokens, and malformed lines, are skipped silently', () => {
  const text = [
    line({ model: 'claude-haiku-5-5' }),
    '{ broken',
    '',
    '[1,2]',
    '"text"',
    line({ costUsd: 'free', inputTokens: 'many' }),
    line({ costUsd: 1 }),
    line({ outputTokens: 5 })
  ].join('\n')
  assert.deepEqual(parseRuns(text).map((row) => [row.costUsd, row.outputTokens]), [[1, 0], [null, 5]])
})

test('mixed client journals include legacy costs and sum only known estimates', () => {
  const rows = parseRuns([
    line({ model: 'claude-sonnet-5-5', costUsd: 0.75 }),
    line({ client: 'claude', billing: 'subscription', costUsd: 0.5 }),
    line({ client: 'codex', billing: 'subscription', costUsd: null }),
    line({ client: 'codex', costUsd: 99, outputTokens: 40, reasoningTokens: 15 }),
    line({ client: 'opencode', billing: 'estimate', costUsd: 0 }),
    line({ client: 'opencode', billing: 'estimate', costUsd: 0.25 }),
    line({ client: 'opencode', billing: 'estimate', costUsd: null }),
    line({ client: 'opencode', billing: 'other', costUsd: 99 })
  ].join('\n'))
  const detail = changeSpendDetail(rows)
  assert.equal(detail?.total.costUsd, 1.5)
  assert.equal(detail?.total.subscriptionRuns, 2)
  assert.equal(detail?.total.unknownBillingRuns, 3)
  assert.equal(detail?.total.outputTokens, 40)
  assert.equal(detail?.total.reasoningTokens, 15)
  const clientSpend = (client: { key: string; runs: number; costUsd: number | null }) => [client.key, client.runs, client.costUsd]
  assert.deepEqual(detail?.byClient.map(clientSpend), [
    ['claude', 2, 1.25],
    ['opencode', 4, 0.25],
    ['codex', 2, null]
  ])
  assert.deepEqual(spendHistory(rows).byClient.map(clientSpend), detail?.byClient.map(clientSpend))
  assert.equal(changeSpend(parseRuns(line({ client: 'opencode', billing: 'estimate', costUsd: 0 })))?.total.costUsd, 0)
})

test('subscription rates price existing tokens using the whole input context and count reasoning once', () => {
  const rates = new Map([['example-model', {
    input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10,
    longContext: { aboveInputTokens: 200_000, input: 4, cacheRead: 0.2, cacheWrite: 5, output: 15 }
  }]])
  const subscription = {
    client: 'codex', billing: 'subscription', model: 'example-model',
    inputTokens: 50_000, cacheReadTokens: 125_000, cacheWriteTokens: 25_000,
    outputTokens: 500, reasoningTokens: 200, costUsd: null
  }
  const rows = parseRuns([
    line(subscription),
    line({ ...subscription, cacheReadTokens: 125_001 }),
    line({ ...subscription, model: 'unknown' }),
    line({ ...subscription, costUsd: 0 })
  ].join('\n'), rates)
  assert.deepEqual(rows.map((row) => row.costUsd), [0.18, 0.3575002, null, 0])
  assert.equal(changeSpend(rows)?.total.costUsd, 0.5375)
  assert.equal(changeSpend(rows)?.total.subscriptionRuns, 4)
})

test('only the last lines of a huge file are read', () => {
  const lines = Array.from({ length: MAX_RUN_LINES + 5 }, (_, index) => line({ costUsd: index }))
  const rows = parseRuns(lines.join('\n'))
  assert.equal(rows.length, MAX_RUN_LINES)
  assert.equal(rows[0].costUsd, 5)
})

test('a change summary sums everything, rounds money and orders models by cost', () => {
  const summary = changeSpend(parseRuns(SAMPLE))
  assert.equal(summary?.total.runs, 4)
  assert.equal(summary?.total.costUsd, 2.5051)
  assert.equal(summary?.total.cacheReadTokens, 58367)
  assert.equal(summary?.total.durationMs, 11514)
  assert.equal(summary?.total.checkFailures, 2)
  assert.equal(summary?.total.escalated, 1)
  assert.deepEqual(summary?.byModel.map((model) => [model.key, model.runs, model.costUsd]), [
    ['claude-sonnet-5-5', 3, 2.5],
    ['claude-haiku-5-5', 1, 0.0051]
  ])
  assert.equal(changeSpend([]), null)
  assert.equal(changeSpendDetail([]), null)
})

test('floating point money does not leak into the totals', () => {
  const rows = parseRuns([line({ costUsd: 0.1 }), line({ costUsd: 0.2 })].join('\n'))
  assert.equal(changeSpend(rows)?.total.costUsd, 0.3)
})

test('the detail groups by task in natural order with no task last, and by agent type by cost', () => {
  const detail = changeSpendDetail(parseRuns(SAMPLE))
  assert.deepEqual(detail?.byTask.map((task) => task.key), ['1.2', '1.10', 'no task'])
  assert.deepEqual(detail?.byAgent.map((agent) => [agent.key, agent.costUsd]), [
    ['main', 2],
    ['unknown', 0.5],
    ['Explore', 0.0051]
  ])
})

test('task order is numeric per segment', () => {
  const keys = ['10', '2.10', 'no task', '2.9', '2', 'b', 'a']
  assert.deepEqual(keys.sort(taskOrder), ['2', '2.9', '2.10', '10', 'a', 'b', 'no task'])
})

test('history groups by month ascending, unknown last, with each month top models', () => {
  const history = spendHistory(parseRuns(SAMPLE))
  assert.deepEqual(history.months.map((month) => [month.month, month.total.costUsd]), [
    ['2026-01', 1.2551],
    ['2026-02', 0.75],
    ['unknown', 0.5]
  ])
  assert.deepEqual(history.months[0].byModel.map((model) => model.key), ['claude-sonnet-5-5', 'claude-haiku-5-5'])
  assert.equal(history.total.costUsd, 2.5051)
  assert.equal(history.byModel[0].key, 'claude-sonnet-5-5')
  assert.deepEqual(spendHistory([]).months, [])
})

test('a time that is not a date goes under the unknown month', () => {
  const history = spendHistory(parseRuns(line({ at: 'yesterday', costUsd: 1 })))
  assert.deepEqual(history.months.map((month) => month.month), ['unknown'])
})
