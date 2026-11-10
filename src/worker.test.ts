import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { fakeFiles } from './fake-files'
import { register } from './handlers'

const PATH = '/work/app'
const CHANGE = `${PATH}/openspec/changes/proj-7-dark-mode`

const BOARD_JSON = JSON.stringify({
  requiredArtifacts: ['proposal.md', 'design.md', 'tasks.md'],
  resumeLine: '^Next:',
  ticket: { pattern: '^proj-(\\d+)', key: 'PROJ-$1' },
  pullRequests: { owner: 'example-org' },
  apply: '/work {ticket}',
  finish: '/close {ticket}'
})

const TREE = {
  [`${PATH}/openspec/board.json`]: BOARD_JSON,
  [`${CHANGE}/proposal.md`]: '# Dark mode',
  [`${CHANGE}/design.md`]: '',
  [`${CHANGE}/tasks.md`]: 'Next: wire the toggle\n- [x] one\n- [ ] two\n',
  [`${PATH}/openspec/changes/proj-8-sketch/proposal.md`]: '',
  [`${PATH}/openspec/changes/proj-9-api/proposal.md`]: '',
  [`${PATH}/openspec/changes/proj-9-api/design.md`]: '',
  [`${PATH}/openspec/changes/proj-9-api/tasks.md`]: '- [ ] one\n',
  [`${PATH}/openspec/changes/proj-10-done/proposal.md`]: '',
  [`${PATH}/openspec/changes/proj-10-done/design.md`]: '',
  [`${PATH}/openspec/changes/proj-10-done/tasks.md`]: '- [x] one\n'
}

const SEARCH_OUTPUT = JSON.stringify([
  {
    number: 3,
    state: 'open',
    isDraft: false,
    title: 'PROJ-7: dark mode toggle',
    url: 'https://github.com/example-org/app/pull/3',
    repository: { nameWithOwner: 'example-org/app' }
  }
])

function setUp(
  agents: { terminalId: string | null }[] = [{ terminalId: 't1' }],
  searchOutput: string | null = SEARCH_OUTPUT,
  tree: Record<string, string> = TREE
) {
  const runs: string[][] = []
  const watchers: { path: string; onChange: () => void; stopped: boolean }[] = []
  const host = mockHost({
    results: {
      'workspace.readContext': { branch: '', displayName: 'PROJ-7', terminals: [] },
      'workspace.list': {
        workspaces: [
          { id: 'w1', kind: 'folder', name: 'PROJ-7', path: PATH, branch: null, hostId: 'local' },
          { id: 'w2', kind: 'folder', name: 'PROJ-9', path: PATH, branch: null, hostId: 'local' },
          { id: 'w3', kind: 'worktree', name: 'PROJ-10-fix', path: '/work/api', branch: 'PROJ-10-fix', hostId: 'local' }
        ],
        truncated: false
      },
      'workspace.open': { opened: true },
      'agents.list': {
        agents: agents.map((agent) => ({ ...agent, title: 'claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }))
      },
      'terminal.sendText': { accepted: true },
      'editor.open': { opened: true }
    }
  })
  const io = {
    ...fakeFiles(tree),
    run: async (command: string, args: string[]) => {
      runs.push([command, ...args])
      return command === 'orca' ? JSON.stringify({ ok: true }) : searchOutput
    },
    watch: (path: string, onChange: () => void) => {
      const watcher = { path, onChange, stopped: false }
      watchers.push(watcher)
      return () => {
        watcher.stopped = true
      }
    }
  }
  const main = { default: (orca: OrcaWorkerApi) => register(orca, io) }
  return { host, runs, main, watchers }
}

test('board: stages, resume line, ticket and pull requests of the focused workspace', async () => {
  const { host, runs, main } = setUp()
  const worker = await mountWorker(main, { host })
  const board = await worker.request('board.get', undefined)
  assert.deepEqual(board.problems, [])
  assert.deepEqual(
    board.changes.map((card) => [card.name, card.stage, card.ticket?.key, card.resume, card.place.kind]),
    [
      ['proj-10-done', 'complete', 'PROJ-10', null, 'new'],
      ['proj-7-dark-mode', 'in-review', 'PROJ-7', 'wire the toggle', 'here'],
      ['proj-8-sketch', 'planning', 'PROJ-8', null, 'none'],
      ['proj-9-api', 'ready', 'PROJ-9', null, 'elsewhere']
    ]
  )
  assert.deepEqual(runs.map((run) => run[run.length - 1]), ['PROJ-10 OR PROJ-7 OR PROJ-8 OR PROJ-9'])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a failed pull request search never makes a ticked change Complete', async () => {
  const { host, main } = setUp(undefined, null)
  const worker = await mountWorker(main, { host })
  const board = await worker.request('board.get', undefined)
  const done = board.changes.find((card) => card.name === 'proj-10-done')
  assert.equal(done?.stage, 'in-progress')
  assert.equal(done?.pullRequestsUnknown, true)
  await worker.deactivate()
})

test('files: only listed changes and their own markdown files are read', async () => {
  const { host, main } = setUp()
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  const ref = { workspaceId: 'w1', change: 'proj-7-dark-mode' }
  assert.deepEqual((await worker.request('change.files', ref)).files, ['proposal.md', 'design.md', 'tasks.md'])
  assert.deepEqual(await worker.request('change.read', { ...ref, path: 'proposal.md' }), { text: '# Dark mode' })
  assert.deepEqual(await worker.request('change.read', { ...ref, path: '../../board.json' }), { text: null })
  assert.deepEqual(await worker.request('change.read', { workspaceId: 'w1', change: '..', path: 'board.json' }), {
    text: null
  })
  assert.deepEqual(await worker.request('change.edit', { ...ref, path: 'design.md' }), {
    opened: true,
    message: 'Opened design.md'
  })
  assert.deepEqual(host.callsOf('editor.open'), [
    { workspaceId: 'w1', path: 'openspec/changes/proj-7-dark-mode/design.md' }
  ])
  assert.equal((await worker.request('change.edit', { ...ref, path: '../../board.json' })).opened, false)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('apply types the configured command into a listed agent terminal only', async () => {
  const { host, main } = setUp()
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  const ref = { workspaceId: 'w1', change: 'proj-7-dark-mode' }
  const apply = { ...ref, command: 'apply' as const }
  assert.deepEqual(await worker.request('change.run', { ...apply, terminalId: 'gone' }), {
    sent: false,
    message: 'That agent terminal is gone'
  })
  assert.equal((await worker.request('change.run', { ...apply, change: 'proj-8-sketch', terminalId: 't1' })).sent, false)
  assert.deepEqual(await worker.request('change.run', { ...ref, command: 'finish', terminalId: 't1' }), {
    sent: false,
    message: 'That change has no finish at its stage'
  })
  assert.deepEqual(await worker.request('change.run', { ...apply, terminalId: 't1' }), {
    sent: true,
    message: 'Sent /work PROJ-7'
  })
  assert.deepEqual(host.callsOf('terminal.sendText'), [{ terminalId: 't1', text: '/work PROJ-7', enter: true }])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a change of another task is never typed into this workspace; its own workspace opens instead', async () => {
  const { host, main } = setUp()
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  assert.deepEqual(
    await worker.request('change.run', { workspaceId: 'w1', change: 'proj-9-api', command: 'apply', terminalId: 't1' }),
    { sent: false, message: 'That change runs in its own workspace, not from here' }
  )
  assert.deepEqual(host.callsOf('terminal.sendText'), [])
  assert.deepEqual(await worker.request('workspace.go', { workspaceId: 'w2' }), { opened: true, message: 'Opened PROJ-9' })
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'w2' }])
  assert.equal((await worker.request('workspace.go', { workspaceId: 'w1' })).opened, false)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a change without its own workspace starts one with an agent that gets the command', async () => {
  const { host, runs, main } = setUp()
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  const ref = { workspaceId: 'w1', change: 'proj-10-done' }
  assert.equal((await worker.request('change.start', { ...ref, command: 'apply' })).started, false)
  assert.equal((await worker.request('change.start', { workspaceId: 'w1', change: 'proj-9-api', command: 'apply' })).started, false)
  assert.deepEqual(await worker.request('change.start', { ...ref, command: 'finish' }), {
    started: true,
    message: 'Created PROJ-10; claude got /close PROJ-10'
  })
  assert.deepEqual(runs.filter((run) => run[0] === 'orca'), [
    [
      'orca',
      'worktree',
      'create',
      '--repo',
      `path:${PATH}`,
      '--name',
      'PROJ-10',
      '--no-parent',
      '--agent',
      'claude',
      '--prompt',
      '/close PROJ-10',
      '--activate',
      '--json'
    ]
  ])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the board watches its changes folder, tells the panel when a file changes, and pins its own change', async () => {
  const { host, main, watchers } = setUp()
  const worker = await mountWorker(main, { host })
  const board = await worker.request('board.get', undefined)
  await worker.request('board.get', undefined)
  assert.deepEqual(
    board.changes.filter((card) => card.inThisWorkspace).map((card) => card.name),
    ['proj-7-dark-mode']
  )
  assert.deepEqual(watchers.map((watcher) => watcher.path), [`${PATH}/openspec/changes`])
  watchers[0].onChange()
  assert.deepEqual(worker.posts.map((post) => post.event), ['board.changed'])
  await worker.deactivate()
})

test('tasks come back as sections of a listed change only', async () => {
  const { host, main } = setUp()
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  assert.deepEqual(await worker.request('change.tasks', { workspaceId: 'w1', change: 'proj-7-dark-mode' }), {
    sections: [{ title: '', tasks: [{ text: 'one', done: true }, { text: 'two', done: false }] }]
  })
  assert.deepEqual(await worker.request('change.tasks', { workspaceId: 'w1', change: '..' }), { sections: null })
  await worker.deactivate()
})

test('a single open task of this workspace change goes to the agent; done or foreign tasks do not', async () => {
  const { host, main } = setUp()
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  const ref = { workspaceId: 'w1', change: 'proj-7-dark-mode', terminalId: 't1' }
  assert.deepEqual(await worker.request('task.run', { ...ref, task: 'two' }), {
    sent: true,
    message: 'Sent /opsx:apply proj-7-dark-mode only task two'
  })
  assert.equal((await worker.request('task.run', { ...ref, task: 'one' })).sent, false)
  assert.equal((await worker.request('task.run', { ...ref, task: 'three' })).sent, false)
  assert.equal((await worker.request('task.run', { ...ref, change: 'proj-9-api', task: 'one' })).sent, false)
  assert.deepEqual(host.callsOf('terminal.sendText'), [
    { terminalId: 't1', text: '/opsx:apply proj-7-dark-mode only task two', enter: true }
  ])
  await worker.deactivate()
})

test('a restarted worker answers for a change before the panel asked for the board again', async () => {
  const { host, main } = setUp()
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('change.tasks', { workspaceId: 'w1', change: 'proj-7-dark-mode' }), {
    sections: [{ title: '', tasks: [{ text: 'one', done: true }, { text: 'two', done: false }] }]
  })
  await worker.deactivate()
})

test('no focused workspace is a problem, not an error', async () => {
  const { main } = setUp()
  const host = mockHost({ results: { 'workspace.readContext': null } })
  const worker = await mountWorker(main, { host })
  const board = await worker.request('board.get', undefined)
  assert.deepEqual(board.problems, ['No workspace is focused'])
  await worker.deactivate()
})

const RUN_LINE = (fields: Record<string, unknown>): string => `${JSON.stringify(fields)}\n`

const SPEND_TREE = {
  ...TREE,
  [`${PATH}/openspec/board.json`]: JSON.stringify({ ...JSON.parse(BOARD_JSON), runs: { folders: ['tmp/agent-runs'] } }),
  [`${CHANGE}/agent-runs.jsonl`]:
    RUN_LINE({ at: '2026-01-10T10:00:00Z', model: 'claude-sonnet-5-5', agentType: 'main', task: '1.2', costUsd: 2 }) +
    RUN_LINE({ at: '2026-01-11T10:00:00Z', model: 'claude-haiku-5-5', agentType: 'Explore', task: '1.10', costUsd: 0.5 }) +
    'not json\n',
  [`${PATH}/openspec/changes/archive/2025-12-01-old/agent-runs.jsonl`]: RUN_LINE({
    at: '2025-12-05T10:00:00Z',
    model: 'claude-sonnet-5-5',
    costUsd: 1
  }),
  [`${PATH}/tmp/agent-runs/loose.jsonl`]: RUN_LINE({ at: '2026-02-01T10:00:00Z', model: 'claude-haiku-5-5', costUsd: 0.25 }),
  [`${PATH}/tmp/agent-runs/notes.txt`]: RUN_LINE({ at: '2026-02-01T10:00:00Z', costUsd: 100 })
}

test('spend: off without runs in board.json, nothing is read or answered', async () => {
  const { host, main } = setUp(undefined, undefined, {
    ...SPEND_TREE,
    [`${PATH}/openspec/board.json`]: BOARD_JSON
  })
  const worker = await mountWorker(main, { host })
  const board = await worker.request('board.get', undefined)
  assert.equal(board.spendEnabled, false)
  assert.deepEqual(board.changes.map((card) => card.spend), [null, null, null, null])
  const ref = { workspaceId: 'w1', change: 'proj-7-dark-mode' }
  assert.deepEqual(await worker.request('change.spend', ref), { spend: null })
  assert.deepEqual(await worker.request('spend.history', undefined), { history: null })
  await worker.deactivate()
})

test('spend: a card carries the sum of its own file; a change without the file shows nothing', async () => {
  const { host, main } = setUp(undefined, undefined, SPEND_TREE)
  const worker = await mountWorker(main, { host })
  const board = await worker.request('board.get', undefined)
  assert.equal(board.spendEnabled, true)
  const spends = Object.fromEntries(board.changes.map((card) => [card.name, card.spend?.total.costUsd ?? null]))
  assert.deepEqual(spends, { 'proj-10-done': null, 'proj-7-dark-mode': 2.5, 'proj-8-sketch': null, 'proj-9-api': null })
  assert.deepEqual(
    board.changes.find((card) => card.name === 'proj-7-dark-mode')?.spend?.byModel.map((model) => model.key),
    ['claude-sonnet-5-5', 'claude-haiku-5-5']
  )
  await worker.deactivate()
})

test('spend: the detail of a listed change only, by task, model and agent', async () => {
  const { host, main } = setUp(undefined, undefined, SPEND_TREE)
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  const { spend } = await worker.request('change.spend', { workspaceId: 'w1', change: 'proj-7-dark-mode' })
  assert.deepEqual(spend?.byTask.map((task) => task.key), ['1.2', '1.10'])
  assert.deepEqual(spend?.byAgent.map((agent) => agent.key), ['main', 'Explore'])
  assert.deepEqual(await worker.request('change.spend', { workspaceId: 'w1', change: '..' }), { spend: null })
  assert.deepEqual(await worker.request('change.spend', { workspaceId: 'w1', change: 'proj-8-sketch' }), { spend: null })
  await worker.deactivate()
})

test('spend: history adds active changes, archived changes and the configured folders only', async () => {
  const { host, main } = setUp(undefined, undefined, SPEND_TREE)
  const worker = await mountWorker(main, { host })
  const { history } = await worker.request('spend.history', undefined)
  assert.equal(history?.total.costUsd, 3.75)
  assert.equal(history?.total.runs, 4)
  assert.deepEqual(history?.months.map((month) => [month.month, month.total.costUsd]), [
    ['2025-12', 1],
    ['2026-01', 2.5],
    ['2026-02', 0.25]
  ])
  await worker.deactivate()
})

test('spend: the disk watcher already covers the file, so no second watcher is added', async () => {
  const { host, main, watchers } = setUp(undefined, undefined, SPEND_TREE)
  const worker = await mountWorker(main, { host })
  await worker.request('board.get', undefined)
  await worker.request('spend.history', undefined)
  assert.deepEqual(watchers.map((watcher) => watcher.path), [`${PATH}/openspec/changes`])
  await worker.deactivate()
})
