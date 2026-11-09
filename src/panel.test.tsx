import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { BoardSnapshot } from './protocol'

const BOARD: BoardSnapshot = {
  workspaceId: 'w1',
  problems: [],
  checkedAt: 0,
  changes: [
    {
      name: 'proj-7-dark-mode',
      stage: 'in-review',
      missing: [],
      tasks: { done: 1, total: 2 },
      resume: 'wire the toggle',
      ticket: { key: 'PROJ-7', url: 'https://tracker.example.com/browse/PROJ-7' },
      pullRequests: [
        {
          repository: 'example-org/app',
          number: 3,
          state: 'open',
          draft: false,
          title: 'PROJ-7: dark mode toggle',
          url: 'https://github.com/example-org/app/pull/3'
        }
      ],
      commands: [{ name: 'apply', text: '/work PROJ-7' }],
      place: { kind: 'here' }
    },
    {
      name: 'proj-8-sketch',
      stage: 'planning',
      missing: ['design.md', 'tasks.md'],
      tasks: { done: 0, total: 0 },
      resume: null,
      ticket: { key: 'PROJ-8', url: null },
      pullRequests: null,
      commands: [],
      place: { kind: 'none', reason: null }
    },
    {
      name: 'proj-9-api',
      stage: 'ready',
      missing: [],
      tasks: { done: 0, total: 1 },
      resume: null,
      ticket: { key: 'PROJ-9', url: null },
      pullRequests: null,
      commands: [{ name: 'apply', text: '/work PROJ-9' }],
      place: { kind: 'elsewhere', workspaceId: 'w2', workspaceName: 'PROJ-9' }
    },
    {
      name: 'proj-5-old',
      stage: 'ready',
      missing: [],
      tasks: { done: 0, total: 1 },
      resume: null,
      ticket: { key: 'PROJ-5', url: null },
      pullRequests: null,
      commands: [{ name: 'apply', text: '/work PROJ-5' }],
      place: { kind: 'none', reason: "Runs in the change's own workspace: create one named PROJ-5 in Orca" }
    },
    {
      name: 'proj-4-shipped',
      stage: 'merged',
      missing: [],
      tasks: { done: 3, total: 5 },
      resume: null,
      ticket: { key: 'PROJ-4', url: null },
      pullRequests: null,
      commands: [{ name: 'finish', text: '/close PROJ-4' }],
      place: { kind: 'new', workspaceName: 'PROJ-4' }
    }
  ]
}

function hostWith(applied: unknown[], state = 'waiting') {
  return mockHost({
    results: {
      'agents.list': {
        agents: [{ terminalId: 't1', title: 'app: working', agent: 'claude', state, stateStartedAt: 0 }]
      },
      'workspace.readContext': {
        branch: 'main',
        displayName: 'PROJ-7',
        terminals: [{ id: 't1', title: '⚪ app: working' }]
      }
    },
    requests: {
      'board.get': () => BOARD,
      'change.files': () => ({ files: ['proposal.md', 'tasks.md'], truncated: false }),
      'change.read': ({ path }) => ({ text: `# ${path}` }),
      'change.run': (input) => {
        applied.push(input)
        return { sent: true, message: 'Sent /work PROJ-7' }
      },
      'change.start': (input) => {
        applied.push(input)
        return { started: true, message: 'Created PROJ-4; claude got /close PROJ-4' }
      },
      'workspace.go': (input) => {
        applied.push(input)
        return { opened: true, message: 'Opened PROJ-9' }
      }
    }
  })
}

test('the board groups changes by stage and shows the resume line, ticket and pull requests', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  assert.ok(view.find({ text: 'In review' }))
  assert.ok(view.find({ text: 'Planning' }))
  assert.ok(view.find({ text: 'Next: wire the toggle' }))
  assert.ok(view.find({ text: 'PROJ-7' }))
  assert.ok(view.find({ text: 'app#3' }))
  assert.ok(view.find({ text: 'Missing: design.md, tasks.md' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('apply goes to the only agent; a planning change has no Apply', async () => {
  const applied: unknown[] = []
  const view = await mount(panel, { host: hostWith(applied) })
  const buttons = view.findAll({ text: 'Apply' })
  assert.equal(buttons.length, 1)
  await view.press(buttons[0])
  assert.deepEqual(applied, [{ workspaceId: 'w1', change: 'proj-7-dark-mode', command: 'apply', terminalId: 't1' }])
  assert.ok(view.find({ text: 'Sent /work PROJ-7' }))
  await view.unmount()
})

test('a change of another task offers its own workspace, never Apply here', async () => {
  const applied: unknown[] = []
  const view = await mount(panel, { host: hostWith(applied) })
  assert.equal(view.findAll({ text: 'Apply' }).length, 1)
  assert.ok(view.find({ text: /create one named PROJ-5 in Orca/ }))
  await view.press({ text: 'Go to PROJ-9' })
  assert.deepEqual(applied, [{ workspaceId: 'w2' }])
  assert.ok(view.find({ text: 'Opened PROJ-9' }))
  await view.unmount()
})

test('a merged change with open tasks says so and finishes in a new workspace of its own', async () => {
  const applied: unknown[] = []
  const view = await mount(panel, { host: hostWith(applied) })
  assert.ok(view.find({ text: 'Merged, tasks open' }))
  assert.ok(view.find({ text: /2 tasks are not ticked/ }))
  await view.press({ text: 'Finish in new PROJ-4' })
  assert.deepEqual(applied, [{ workspaceId: 'w1', change: 'proj-4-shipped', command: 'finish' }])
  assert.ok(view.find({ text: 'Created PROJ-4; claude got /close PROJ-4' }))
  await view.unmount()
})

test('stage buttons count the changes and show one stage at a time', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  assert.ok(view.find({ text: 'All 5' }))
  await view.press({ text: 'Ready 2' })
  assert.ok(view.find({ text: 'PROJ-9' }))
  assert.equal(view.find({ text: 'PROJ-7' }), null)
  await view.press({ text: 'Ready 2' })
  assert.ok(view.find({ text: 'PROJ-7' }))
  await view.unmount()
})

test('the agent is named by its kind, its state and its own title without the status parts', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  const picker = view.find({ label: 'Apply and Finish send their command to an agent of "PROJ-7"' })
  assert.deepEqual(picker?.props.options, [{ value: 't1', label: 'Claude, waiting for you — "app"' }])
  await view.unmount()
})

test('status glyphs and a trailing state are cut from an agent title', () => {
  assert.equal(panel.cleanTitle('⚪ claude: done'), 'claude')
  assert.equal(panel.cleanTitle('⚪ app: needs approval'), 'app')
  assert.equal(panel.cleanTitle('✳ working'), 'working')
  assert.equal(panel.cleanTitle(null), '')
})

test('Apply is disabled while the agent is busy or waits for an approval', async () => {
  for (const state of ['working', 'blocked']) {
    const applied: unknown[] = []
    const view = await mount(panel, { host: hostWith(applied, state) })
    const apply = view.find({ text: 'Apply' })
    assert.equal(apply?.disabled, true, state)
    assert.ok(view.find({ text: /Apply and Finish wait until it stops/ }), state)
    assert.deepEqual(applied, [])
    await view.unmount()
  }
})

test('opening a change shows its first file and goes back to the board', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  await view.press(view.findAll({ text: 'Open' })[0])
  assert.equal(view.find({ label: 'File' })?.props.value, 'proposal.md')
  assert.equal(view.find({ type: 'Markdown' })?.props.content, '# proposal.md')
  await view.press({ text: 'Back to board' })
  assert.ok(view.find({ text: 'In review' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
