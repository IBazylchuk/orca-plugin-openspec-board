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
      applicable: true
    },
    {
      name: 'proj-8-sketch',
      stage: 'planning',
      missing: ['design.md', 'tasks.md'],
      tasks: { done: 0, total: 0 },
      resume: null,
      ticket: { key: 'PROJ-8', url: null },
      pullRequests: null,
      applicable: false
    }
  ]
}

function hostWith(applied: unknown[]) {
  return mockHost({
    results: {
      'agents.list': {
        agents: [{ terminalId: 't1', title: 'claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }]
      }
    },
    requests: {
      'board.get': () => BOARD,
      'change.files': () => ({ files: ['proposal.md', 'tasks.md'], truncated: false }),
      'change.read': ({ path }) => ({ text: `# ${path}` }),
      'change.apply': (input) => {
        applied.push(input)
        return { sent: true, message: 'Sent /work PROJ-7' }
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
