import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { BoardSnapshot, Spend } from './protocol'

const BOARD: BoardSnapshot = {
  workspaceId: 'w1',
  problems: [],
  spendEnabled: false,
  pullRequestsPending: false,
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
      pullRequestsUnknown: false,
      spend: null,
      inThisWorkspace: true,
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
      pullRequestsUnknown: false,
      spend: null,
      inThisWorkspace: false,
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
      pullRequestsUnknown: false,
      spend: null,
      inThisWorkspace: false,
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
      pullRequestsUnknown: false,
      spend: null,
      inThisWorkspace: false,
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
      pullRequestsUnknown: false,
      spend: null,
      inThisWorkspace: false,
      commands: [{ name: 'finish', text: '/close PROJ-4' }],
      place: { kind: 'new', workspaceName: 'PROJ-4' }
    }
  ]
}

const LONG_TASK = `2.5 ${'merged and deployed, checked on production; '.repeat(25)}`

function hostWith(applied: unknown[], state = 'waiting', taskText = '1.2 wire it', board: BoardSnapshot = BOARD, pullRequests: () => BoardSnapshot = () => board) {
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
      'board.get': () => board,
      'board.pullRequests': pullRequests,
      'change.files': () => ({ files: ['proposal.md', 'tasks.md'], truncated: false }),
      'change.read': ({ path }) => ({ text: `# ${path}` }),
      'change.spend': () => ({ spend: DETAIL }),
      'spend.history': () => ({ history: HISTORY }),
      'change.tasks': () => ({
        sections: [{ title: '1. Toggle', tasks: [{ text: '1.1 store the flag', done: true }, { text: taskText, done: false }] }]
      }),
      'change.run': (input) => {
        applied.push(input)
        return { sent: true, message: 'Sent /work PROJ-7' }
      },
      'change.start': (input) => {
        applied.push(input)
        return { started: true, message: 'Created PROJ-4; claude got /close PROJ-4' }
      },
      'task.run': (input) => {
        applied.push(input)
        return { sent: true, message: 'Sent /work PROJ-7 only task 1.2 wire it' }
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
  assert.ok(view.find({ text: 'This workspace' }))
  assert.ok(view.find({ text: 'Planning' }))
  assert.ok(view.find({ text: 'Next: wire the toggle' }))
  assert.ok(view.find({ text: 'PROJ-7' }))
  assert.ok(view.find({ text: 'app#3' }))
  assert.ok(view.find({ text: 'Missing: design.md, tasks.md' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the board draws when the pull request request fails, and says they are being checked first', async () => {
  const pending = { ...BOARD, pullRequestsPending: true, changes: BOARD.changes.map((card) => ({ ...card, pullRequestsUnknown: true })) }
  const host = hostWith([], 'waiting', '1.2 wire it', pending, () => {
    throw new Error('board.pullRequests timed out after 60000ms')
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Planning' }))
  assert.ok(view.find({ text: 'Pull requests could not be checked, so the stage ignores them; Refresh to retry.' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a pending board says the pull requests are being checked', async () => {
  const pending = { ...BOARD, pullRequestsPending: true, changes: BOARD.changes.map((card) => ({ ...card, pullRequestsUnknown: true })) }
  const host = hostWith([], 'waiting', '1.2 wire it', pending, () => pending)
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Checking pull requests…' }))
  await view.unmount()
})

test('while a load runs a new one waits and runs once, and the fresh flag is kept', async () => {
  const started: boolean[] = []
  let release: () => void = () => undefined
  const load = panel.singleFlight(async (fresh) => {
    started.push(fresh)
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  const first = load()
  void load()
  void load(true)
  void load()
  assert.deepEqual(started, [false])
  release()
  await first
  await Promise.resolve()
  assert.deepEqual(started, [false, true])
  release()
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
  assert.equal(view.find({ text: 'PROJ-8' }), null)
  assert.ok(view.find({ text: 'PROJ-7' }))
  await view.press({ text: 'Ready 2' })
  assert.ok(view.find({ text: 'PROJ-8' }))
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

test('a very long task still draws as a checkbox with its whole text', async () => {
  const view = await mount(panel, { host: hostWith([], 'waiting', LONG_TASK) })
  await view.press(view.findAll({ text: 'Open' })[0])
  assert.deepEqual(view.refusals, [])
  const boxes = view.findAll({ type: 'Checkbox' })
  assert.equal(boxes.length, 2)
  const shown = `${boxes[1].label ?? ''} ${view.find({ text: /^…/ })?.text ?? ''}`.replaceAll('…', '').replace(/\s+/g, ' ')
  assert.equal(shown, LONG_TASK.replace(/\s+/g, ' ').trim())
  assert.ok(view.find({ label: 'Run task 2.5' }))
  assert.deepEqual(panel.splitLabel('short'), { label: 'short', rest: '' })
  await view.unmount()
})

test('the change of this workspace is pinned on top', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  const headings = view.findAll({ type: 'Heading' }).map((heading) => heading.text)
  assert.equal(headings.indexOf('This workspace'), 1)
  await view.unmount()
})

test('opening a change shows its task list, then its files, and goes back to the board', async () => {
  const applied: unknown[] = []
  const view = await mount(panel, { host: hostWith(applied) })
  await view.press(view.findAll({ text: 'Open' })[0])
  assert.equal(view.find({ label: '1.1 store the flag' })?.props.checked, true)
  assert.equal(view.find({ label: '1.2 wire it' })?.props.checked, false)
  assert.equal(view.find({ type: 'Collapsible' })?.props.description, '1 of 2 done')
  assert.equal(view.find({ label: 'Run task 1.1' }), null)
  await view.press({ label: 'Run task 1.2' })
  assert.ok(view.find({ text: 'Sent /work PROJ-7 only task 1.2 wire it' }))
  assert.deepEqual(applied, [
    { workspaceId: 'w1', change: 'proj-7-dark-mode', task: '1.2 wire it', terminalId: 't1' }
  ])
  await view.select({ label: 'Change' }, 'files')
  assert.equal(view.find({ label: 'File' })?.props.value, 'proposal.md')
  assert.equal(view.find({ type: 'Markdown' })?.props.content, '# proposal.md')
  await view.press({ text: 'Back to board' })
  assert.ok(view.find({ text: 'This workspace' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

const spend = (key: string, runs: number, costUsd: number): Spend => ({
  key,
  runs,
  costUsd,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 58367,
  outputTokens: 1_200_000,
  durationMs: 90_000,
  checkFailures: 1,
  escalated: 2
})

const MODELS = [spend('claude-sonnet-5-5', 3, 7.1), spend('claude-fable-5-2', 2, 4.9), spend('claude-haiku-5-5', 4, 0.4)]

const WITH_SPEND: BoardSnapshot = {
  ...BOARD,
  spendEnabled: true,
  pullRequestsPending: false,
  changes: BOARD.changes.map((card, index) =>
    index === 0 ? { ...card, spend: { total: spend('total', 9, 12.4), byModel: MODELS } } : card
  )
}

const DETAIL = {
  total: spend('total', 9, 12.4),
  byModel: MODELS,
  byTask: [spend('1.2', 2, 1.5), spend('1.10', 3, 9.9), spend('no task', 4, 1)],
  byAgent: [spend('main', 5, 11), spend('Explore', 4, 1.4)]
}

const HISTORY = {
  total: spend('total', 14, 15.4),
  byModel: MODELS,
  months: [
    { month: '2026-01', total: spend('2026-01', 5, 3), byModel: [spend('claude-haiku-5-5', 5, 3)] },
    { month: '2026-02', total: spend('2026-02', 9, 12.4), byModel: MODELS }
  ]
}

test('no agent runs line and no Spend control while the feature is off', async () => {
  const view = await mount(panel, { host: hostWith([]) })
  assert.equal(view.find({ text: /Agent runs/ }), null)
  assert.equal(view.find({ text: 'Spend' }), null)
  await view.press(view.findAll({ text: 'Open' })[0])
  assert.equal(view.find({ label: 'Agent runs' }), null)
  assert.equal(view.find({ text: 'Agent runs' }), null)
  await view.unmount()
})

test('a card with runs shows one quiet line with its models', async () => {
  const view = await mount(panel, { host: hostWith([], "waiting", "1.2 wire it", WITH_SPEND) })
  assert.ok(view.find({ text: 'Agent runs: $12.40 · sonnet-5-5 $7.10 · fable-5-2 $4.90 · haiku-5-5 $0.40' }))
  assert.equal(view.findAll({ text: /^Agent runs:/ }).length, 1)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the opened change lists its runs by task, model and agent type', async () => {
  const view = await mount(panel, { host: hostWith([], "waiting", "1.2 wire it", WITH_SPEND) })
  await view.press(view.findAll({ text: 'Open' })[0])
  await view.select({ label: 'Change' }, 'runs')
  const byTask = view.find({ type: 'Table', label: 'Agent runs by task' })
  assert.deepEqual(byTask?.props.rows, [
    {
      key: '1.2',
      cells: { task: '1.2', runs: 2, cost: '$1.50', cacheRead: '58.4k', output: '1.2M', minutes: '1.5', failedChecks: 1, escalated: 2 }
    },
    {
      key: '1.10',
      cells: { task: '1.10', runs: 3, cost: '$9.90', cacheRead: '58.4k', output: '1.2M', minutes: '1.5', failedChecks: 1, escalated: 2 }
    },
    {
      key: 'no task',
      cells: { task: 'no task', runs: 4, cost: '$1.00', cacheRead: '58.4k', output: '1.2M', minutes: '1.5', failedChecks: 1, escalated: 2 }
    }
  ])
  const byModel = view.find({ type: 'Table', label: 'Agent runs by model' })
  assert.equal((byModel?.props.rows as { cells: { name: string } }[])[0].cells.name, 'sonnet-5-5')
  const byAgent = view.find({ type: 'Table', label: 'Agent runs by agent type' })
  assert.deepEqual(byAgent?.props.rows, [
    { key: 'main', cells: { name: 'main', runs: 5, cost: '$11.00' } },
    { key: 'Explore', cells: { name: 'Explore', runs: 4, cost: '$1.40' } }
  ])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a change without runs has no Agent runs tab even when the feature is on', async () => {
  const noRuns: BoardSnapshot = { ...WITH_SPEND, changes: BOARD.changes.map((card) => ({ ...card, spend: null })) }
  const view = await mount(panel, { host: hostWith([], "waiting", "1.2 wire it", noRuns) })
  assert.equal(view.find({ text: /^Agent runs:/ }), null)
  await view.press(view.findAll({ text: 'Open' })[0])
  assert.equal(view.find({ type: 'Table' }), null)
  await view.unmount()
})

test('Spend shows the grand total, the models and the months with a running total', async () => {
  const view = await mount(panel, { host: hostWith([], "waiting", "1.2 wire it", WITH_SPEND) })
  assert.equal(view.find({ type: 'Table', label: 'Spend by month' }), null)
  await view.press({ text: 'Spend' })
  assert.ok(view.find({ text: 'Agent spend, all changes: $15.40 in 14 runs' }))
  const months = view.find({ type: 'Table', label: 'Spend by month' })
  assert.deepEqual(months?.props.rows, [
    { key: '2026-01', cells: { month: '2026-01', runs: 5, cost: '$3.00', cumulative: '$3.00', models: 'haiku-5-5 $3.00' } },
    {
      key: '2026-02',
      cells: {
        month: '2026-02',
        runs: 9,
        cost: '$12.40',
        cumulative: '$15.40',
        models: 'sonnet-5-5 $7.10, fable-5-2 $4.90, haiku-5-5 $0.40'
      }
    }
  ])
  assert.equal((view.find({ type: 'Table', label: 'Spend by model' })?.props.rows as unknown[]).length, 3)
  await view.press({ text: 'Spend' })
  assert.equal(view.find({ type: 'Table', label: 'Spend by month' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
