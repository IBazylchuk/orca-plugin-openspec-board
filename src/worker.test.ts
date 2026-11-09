import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { fakeFiles } from './fake-files'
import { register } from './handlers'

const PATH = '/work/app'
const CHANGE = `${PATH}/openspec/changes/proj-7-dark-mode`

const BOARD_JSON = JSON.stringify({
  requiredArtifacts: ['proposal.md', 'design.md', 'tasks.md'],
  complete: 'pullRequests',
  resumeLine: '^Next:',
  ticket: { pattern: '^proj-(\\d+)', key: 'PROJ-$1' },
  pullRequests: { owner: 'example-org' },
  apply: '/work {ticket}'
})

const TREE = {
  [`${PATH}/openspec/board.json`]: BOARD_JSON,
  [`${CHANGE}/proposal.md`]: '# Dark mode',
  [`${CHANGE}/design.md`]: '',
  [`${CHANGE}/tasks.md`]: 'Next: wire the toggle\n- [x] one\n- [ ] two\n',
  [`${PATH}/openspec/changes/proj-8-sketch/proposal.md`]: '',
  [`${PATH}/openspec/changes/proj-9-api/proposal.md`]: '',
  [`${PATH}/openspec/changes/proj-9-api/design.md`]: '',
  [`${PATH}/openspec/changes/proj-9-api/tasks.md`]: '- [ ] one\n'
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

function setUp(agents: { terminalId: string | null }[] = [{ terminalId: 't1' }]) {
  const runs: string[][] = []
  const host = mockHost({
    results: {
      'workspace.readContext': { branch: '', displayName: 'PROJ-7', terminals: [] },
      'workspace.list': {
        workspaces: [
          { id: 'w1', kind: 'folder', name: 'PROJ-7', path: PATH, branch: null, hostId: 'local' },
          { id: 'w2', kind: 'folder', name: 'PROJ-9', path: PATH, branch: null, hostId: 'local' }
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
    ...fakeFiles(TREE),
    run: async (command: string, args: string[]) => {
      runs.push([command, ...args])
      return SEARCH_OUTPUT
    }
  }
  const main = { default: (orca: OrcaWorkerApi) => register(orca, io) }
  return { host, runs, main }
}

test('board: stages, resume line, ticket and pull requests of the focused workspace', async () => {
  const { host, runs, main } = setUp()
  const worker = await mountWorker(main, { host })
  const board = await worker.request('board.get', undefined)
  assert.deepEqual(board.problems, [])
  assert.deepEqual(
    board.changes.map((card) => [card.name, card.stage, card.ticket?.key, card.resume, card.apply.kind]),
    [
      ['proj-7-dark-mode', 'in-review', 'PROJ-7', 'wire the toggle', 'here'],
      ['proj-8-sketch', 'planning', 'PROJ-8', null, 'none'],
      ['proj-9-api', 'ready', 'PROJ-9', null, 'elsewhere']
    ]
  )
  assert.deepEqual(runs.map((run) => run[run.length - 1]), ['PROJ-7 OR PROJ-8 OR PROJ-9'])
  assert.deepEqual(worker.refusals, [])
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
  assert.deepEqual(await worker.request('change.apply', { ...ref, terminalId: 'gone' }), {
    sent: false,
    message: 'That agent terminal is gone'
  })
  assert.equal((await worker.request('change.apply', { ...ref, change: 'proj-8-sketch', terminalId: 't1' })).sent, false)
  assert.deepEqual(await worker.request('change.apply', { ...ref, terminalId: 't1' }), {
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
  assert.deepEqual(await worker.request('change.apply', { workspaceId: 'w1', change: 'proj-9-api', terminalId: 't1' }), {
    sent: false,
    message: 'That change is applied in its own workspace, not from here'
  })
  assert.deepEqual(host.callsOf('terminal.sendText'), [])
  assert.deepEqual(await worker.request('workspace.go', { workspaceId: 'w2' }), { opened: true, message: 'Opened PROJ-9' })
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'w2' }])
  assert.equal((await worker.request('workspace.go', { workspaceId: 'w1' })).opened, false)
  assert.deepEqual(worker.refusals, [])
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
