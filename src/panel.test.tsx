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
      apply: { kind: 'here' }
    },
    {
      name: 'proj-8-sketch',
      stage: 'planning',
      missing: ['design.md', 'tasks.md'],
      tasks: { done: 0, total: 0 },
      resume: null,
      ticket: { key: 'PROJ-8', url: null },
      pullRequests: null,
      apply: { kind: 'none', reason: null }
    },
    {
      name: 'proj-9-api',
      stage: 'ready',
      missing: [],
      tasks: { done: 0, total: 1 },
      resume: null,
      ticket: { key: 'PROJ-9', url: null },
      pullRequests: null,
      apply: { kind: 'elsewhere', workspaceId: 'w2', workspaceName: 'PROJ-9' }
    },
    {
      name: 'proj-5-old',
      stage: 'ready',
      missing: [],
      tasks: { done: 0, total: 1 },
      resume: null,
      ticket: { key: 'PROJ-5', url: null },
      pullRequests: null,
      apply: { kind: 'none', reason: "Apply runs in the change's own workspace: create one named PROJ-5 in Orca" }
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
      'change.apply': (input) => {
        applied.push(input)
        return { sent: true, message: 'Sent /work PROJ-7' }
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
  assert.deepEqual(applied, [{ workspaceId: 'w1', change: 'proj-7-dark-mode', terminalId: 't1' }])
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

test('the agent is named by its kind, its state and its own title without the status parts', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  const picker = view.find({ label: 'Apply sends the command to an agent of "PROJ-7"' })
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
    assert.ok(view.find({ text: /Apply waits until it stops/ }), state)
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
