import { assert, test } from 'orca/testing'
import { CACHE_MS, FAILURE_MS, GH_TIMEOUT_MS, PARALLEL_SEARCHES, mentionsKey as mentionsTicket, parseSearch, pullRequestFinder, pullRequestsOf, TICKETS_PER_SEARCH } from './pull-requests'

const row = (number: number, title: string, state = 'open') => ({
  number,
  state,
  isDraft: false,
  title,
  url: `https://github.com/example-org/app/pull/${number}`,
  repository: { nameWithOwner: 'example-org/app' }
})

const rule = { owner: 'example-org', search: '{ticket} in:title' }

test('a ticket matches as a whole key, never as a prefix of a longer one', () => {
  assert.equal(mentionsTicket('PROJ-7: dark mode', 'PROJ-7'), true)
  assert.equal(mentionsTicket('Fix (proj-7) toggle', 'PROJ-7'), true)
  assert.equal(mentionsTicket('PROJ-71: other work', 'PROJ-7'), false)
  assert.equal(mentionsTicket('XPROJ-7 other', 'PROJ-7'), false)
})

test('search rows are validated, then split by the ticket their title names', () => {
  const found = parseSearch(
    JSON.stringify([
      row(2, 'PROJ-7: theme tokens', 'merged'),
      row(1, 'PROJ-7: dark mode'),
      row(3, 'PROJ-71: unrelated'),
      { ...row(4, 'PROJ-7: bad url'), url: 'javascript:alert(1)' },
      { ...row(5, 'PROJ-7: odd state'), state: 'weird' }
    ])
  )
  assert.deepEqual(
    pullRequestsOf(found ?? [], 'PROJ-7').map((pr) => [pr.number, pr.state]),
    [
      [1, 'open'],
      [2, 'merged']
    ]
  )
  assert.deepEqual(pullRequestsOf(found ?? [], 'PROJ-71').map((pr) => pr.number), [3])
  assert.equal(parseSearch('not json'), null)
})

test('one search covers up to six tickets, and the cache spares the next look', async () => {
  const queries: string[] = []
  let clock = 0
  const find = pullRequestFinder(
    async (_command, args) => {
      queries.push(args[args.length - 1])
      return JSON.stringify([row(1, 'PROJ-1: one'), row(8, 'PROJ-8: eight')])
    },
    () => clock
  )
  const tickets = Array.from({ length: TICKETS_PER_SEARCH + 2 }, (_, index) => `PROJ-${index + 1}`)
  const found = await find(rule, tickets)
  assert.equal(queries.length, 2)
  assert.equal(queries[0], 'PROJ-1 OR PROJ-2 OR PROJ-3 OR PROJ-4 OR PROJ-5 OR PROJ-6 in:title')
  assert.deepEqual(found.get('PROJ-1')?.map((pr) => pr.number), [1])
  assert.deepEqual(found.get('PROJ-8')?.map((pr) => pr.number), [8])
  assert.deepEqual(found.get('PROJ-2'), [])

  await find(rule, tickets)
  assert.equal(queries.length, 2)
  clock = CACHE_MS
  await find(rule, tickets)
  assert.equal(queries.length, 4)
  await find(rule, tickets, true)
  assert.equal(queries.length, 6)
})

test('a failed search keeps what the last one found', async () => {
  let fail = false
  let clock = 0
  const find = pullRequestFinder(
    async () => (fail ? null : JSON.stringify([row(1, 'PROJ-1: one')])),
    () => clock
  )
  assert.deepEqual((await find(rule, ['PROJ-1'])).get('PROJ-1')?.length, 1)
  fail = true
  clock = CACHE_MS
  assert.deepEqual((await find(rule, ['PROJ-1'])).get('PROJ-1')?.length, 1)
  assert.equal((await find(rule, ['PROJ-2'])).get('PROJ-2'), null)
})

test('searches run in parallel up to the cap, each with the gh timeout', async () => {
  let running = 0
  let peak = 0
  const timeouts: (number | undefined)[] = []
  const find = pullRequestFinder(async (_command, _args, timeoutMs) => {
    timeouts.push(timeoutMs)
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running -= 1
    return '[]'
  })
  const tickets = Array.from({ length: TICKETS_PER_SEARCH * (PARALLEL_SEARCHES + 2) }, (_, index) => `PROJ-${index + 1}`)
  await find(rule, tickets)
  assert.equal(timeouts.length, PARALLEL_SEARCHES + 2)
  assert.equal(peak, PARALLEL_SEARCHES)
  assert.deepEqual([...new Set(timeouts)], [GH_TIMEOUT_MS])
})

test('a search that hits its timeout answers null and leaves the tickets unknown', async () => {
  const find = pullRequestFinder(async () => null)
  const found = await find(rule, ['PROJ-1', 'PROJ-2'])
  assert.equal(found.get('PROJ-1'), null)
  assert.equal(found.get('PROJ-2'), null)
})

test('a failed search is not repeated for a minute, a fresh look repeats it', async () => {
  let calls = 0
  let clock = 0
  const find = pullRequestFinder(
    async () => {
      calls += 1
      return null
    },
    () => clock
  )
  await find(rule, ['PROJ-1'])
  await find(rule, ['PROJ-1'])
  assert.equal(calls, 1)
  clock = FAILURE_MS - 1
  await find(rule, ['PROJ-1'])
  assert.equal(calls, 1)
  clock = FAILURE_MS
  await find(rule, ['PROJ-1'])
  assert.equal(calls, 2)
  await find(rule, ['PROJ-1'], true)
  assert.equal(calls, 3)
})

test('remembered answers from the cache without a search', async () => {
  let calls = 0
  const find = pullRequestFinder(async () => {
    calls += 1
    return JSON.stringify([row(1, 'PROJ-1: one')])
  })
  assert.equal(find.remembered(rule, ['PROJ-1']).get('PROJ-1'), null)
  await find(rule, ['PROJ-1'])
  assert.equal(find.remembered(rule, ['PROJ-1']).get('PROJ-1')?.length, 1)
  assert.equal(calls, 1)
})
