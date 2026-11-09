import { assert, test } from 'orca/testing'
import { commandsOf, listChangeFiles, listChanges, MAX_FILES, readCard, resumeLine, stageOf } from './changes'
import { DEFAULT_CONFIG, parseConfig } from './config'
import { fakeFiles } from './fake-files'
import type { PullRequest } from './protocol'

const ROOT = '/repo/openspec'

const pr = (state: PullRequest['state']): PullRequest => ({
  repository: 'example-org/app',
  number: 1,
  state,
  draft: false,
  title: 'PROJ-7: dark mode',
  url: 'https://github.com/example-org/app/pull/1'
})

const ours = parseConfig(
  JSON.stringify({
    requiredArtifacts: ['proposal.md', 'design.md', 'tasks.md'],
    resumeLine: '^Next:',
    ticket: { pattern: '^proj-(\\d+)', key: 'PROJ-$1', url: 'https://tracker.example.com/browse/{ticket}' },
    pullRequests: { owner: 'example-org' },
    files: { exclude: ['research'] }
  })
).config

test('lists change folders, never the archive, dot folders or plain files', async () => {
  const files = fakeFiles({
    [`${ROOT}/changes/add-dark-mode/proposal.md`]: '',
    [`${ROOT}/changes/archive/2026-01-01-old/proposal.md`]: '',
    [`${ROOT}/changes/.cache/x.md`]: '',
    [`${ROOT}/changes/README.md`]: ''
  })
  assert.deepEqual(await listChanges(files, ROOT), ['add-dark-mode'])
  assert.equal(await listChanges(fakeFiles({}), ROOT), null)
})

test('plain OpenSpec: specs are required unless skip_specs is set', async () => {
  const dir = `${ROOT}/changes/add-dark-mode`
  const base = {
    [`${dir}/proposal.md`]: '',
    [`${dir}/design.md`]: '',
    [`${dir}/tasks.md`]: '- [x] one\n- [ ] two\n'
  }
  const planning = await readCard(fakeFiles(base), ROOT, 'add-dark-mode', DEFAULT_CONFIG, null)
  assert.equal(planning.stage, 'planning')
  assert.deepEqual(planning.missing, ['specs'])

  const skipped = await readCard(
    fakeFiles({ ...base, [`${dir}/.openspec.yaml`]: 'schema: spec-driven\nskip_specs: true\n' }),
    ROOT,
    'add-dark-mode',
    DEFAULT_CONFIG,
    null
  )
  assert.equal(skipped.stage, 'in-progress')
  assert.deepEqual(skipped.tasks, { done: 1, total: 2 })
})

test('configured project: resume line, ticket and stage by pull requests', async () => {
  const dir = `${ROOT}/changes/proj-7-dark-mode`
  const files = fakeFiles({
    [`${dir}/proposal.md`]: '',
    [`${dir}/design.md`]: '',
    [`${dir}/tasks.md`]: 'Next: wire the toggle\n\n- [x] one\n- [ ] two\n'
  })
  const unknown = await readCard(
    fakeFiles({
      [`${dir}/proposal.md`]: '',
      [`${dir}/design.md`]: '',
      [`${dir}/tasks.md`]: '- [x] one\n'
    }),
    ROOT,
    'proj-7-dark-mode',
    ours,
    null
  )
  assert.equal(unknown.stage, 'in-progress')
  assert.equal(unknown.pullRequestsUnknown, true)
  const card = await readCard(files, ROOT, 'proj-7-dark-mode', ours, [pr('open')])
  assert.equal(card.stage, 'in-review')
  assert.equal(card.pullRequestsUnknown, false)
  assert.equal(card.resume, 'wire the toggle')
  assert.deepEqual(card.ticket, { key: 'PROJ-7', url: 'https://tracker.example.com/browse/PROJ-7' })
  assert.deepEqual(card.place, { kind: 'here' })
  assert.deepEqual(card.commands, [{ name: 'apply', text: '/opsx:apply proj-7-dark-mode' }])
})

test('the resume line reads its whole paragraph, up to a blank line or a list', () => {
  const pattern = /^(#+\s*)?Next\b.*?:\s/m
  const markdown = 'Next (checked 08:36 UTC): hourly capacity\nand the overnight run.\n- [ ] one\n'
  assert.equal(resumeLine(markdown, pattern), 'hourly capacity and the overnight run.')
  assert.equal(resumeLine('Next: wire it\n\nlater text\n', /^Next:/m), 'wire it')
  assert.equal(resumeLine('nothing here', pattern), null)
})

test('a change without a ticket cannot be applied when the command needs one', async () => {
  const dir = `${ROOT}/changes/tidy-up`
  const files = fakeFiles({ [`${dir}/proposal.md`]: '', [`${dir}/design.md`]: '', [`${dir}/tasks.md`]: '- [ ] one\n' })
  const card = await readCard(files, ROOT, 'tidy-up', { ...ours, apply: '/work {ticket}' }, null)
  assert.equal(card.stage, 'ready')
  assert.deepEqual(card.place, {
    kind: 'none',
    reason: 'The command needs a ticket, and "tidy-up" does not match the ticket pattern'
  })
  assert.deepEqual(card.commands, [])
})

test('stage table: Complete needs every task ticked and no open pull request', () => {
  const tasks = (done: number, total: number) => ({ done, total })
  const cases: [Parameters<typeof stageOf>[0], string][] = [
    [{ missing: ['design.md'], tasks: tasks(3, 3), pullRequests: [pr('merged')], pullRequestsUnknown: false }, 'planning'],
    [{ missing: [], tasks: tasks(0, 4), pullRequests: null, pullRequestsUnknown: false }, 'ready'],
    [{ missing: [], tasks: tasks(2, 4), pullRequests: null, pullRequestsUnknown: false }, 'in-progress'],
    [{ missing: [], tasks: tasks(4, 4), pullRequests: null, pullRequestsUnknown: false }, 'complete'],
    [{ missing: [], tasks: tasks(4, 4), pullRequests: [pr('open')], pullRequestsUnknown: false }, 'in-review'],
    [{ missing: [], tasks: tasks(2, 4), pullRequests: [pr('open')], pullRequestsUnknown: false }, 'in-review'],
    [{ missing: [], tasks: tasks(1, 4), pullRequests: [pr('merged'), pr('open')], pullRequestsUnknown: false }, 'in-review'],
    [{ missing: [], tasks: tasks(1, 4), pullRequests: [pr('merged'), pr('closed')], pullRequestsUnknown: false }, 'merged'],
    [{ missing: [], tasks: tasks(4, 4), pullRequests: [pr('merged'), pr('closed')], pullRequestsUnknown: false }, 'complete'],
    [{ missing: [], tasks: tasks(1, 4), pullRequests: [pr('closed')], pullRequestsUnknown: false }, 'in-progress'],
    [{ missing: [], tasks: tasks(0, 4), pullRequests: [], pullRequestsUnknown: false }, 'ready'],
    [{ missing: [], tasks: tasks(4, 4), pullRequests: null, pullRequestsUnknown: true }, 'in-progress']
  ]
  for (const [input, expected] of cases) {
    assert.equal(stageOf(input), expected, JSON.stringify(input))
  }
})

test('commands by stage: Finish once the work is in, and from 80% of the tasks in review', () => {
  const config = { apply: '/work {ticket}', finish: '/close {ticket}' }
  const ticket = { key: 'PROJ-7', url: null }
  const names = (stage: Parameters<typeof commandsOf>[0], done: number) =>
    commandsOf(stage, { done, total: 10 }, config, 'proj-7', ticket).commands.map((command) => command.name)
  assert.deepEqual(names('planning', 0), [])
  assert.deepEqual(names('ready', 0), ['apply'])
  assert.deepEqual(names('in-review', 7), ['apply'])
  assert.deepEqual(names('in-review', 8), ['apply', 'finish'])
  assert.deepEqual(names('merged', 3), ['finish'])
  assert.deepEqual(names('complete', 10), ['finish'])
  const same = commandsOf('in-review', { done: 9, total: 10 }, { apply: '/work {ticket}', finish: '/work {ticket}' }, 'proj-7', ticket)
  assert.deepEqual(same.commands, [{ name: 'apply', text: '/work PROJ-7' }])
})

test('plain OpenSpec: the default Finish needs no ticket and ends in the archive command', () => {
  const { commands } = commandsOf('merged', { done: 1, total: 2 }, DEFAULT_CONFIG, 'add-dark-mode', null)
  assert.equal(commands.length, 1)
  assert.ok(commands[0].text.includes('/opsx:archive add-dark-mode'))
})

test('change files: every markdown file, main ones first, excluded folders never walked', async () => {
  const dir = `${ROOT}/changes/proj-7-dark-mode`
  const files = fakeFiles({
    [`${dir}/tasks.md`]: '',
    [`${dir}/proposal.md`]: '',
    [`${dir}/evidence.md`]: '',
    [`${dir}/queries.sql`]: '',
    [`${dir}/specs/theme/spec.md`]: '',
    [`${dir}/research/huge/notes.md`]: ''
  })
  const result = await listChangeFiles(files, ROOT, 'proj-7-dark-mode', ['research'])
  assert.deepEqual(result, {
    files: ['proposal.md', 'tasks.md', 'evidence.md', 'specs/theme/spec.md'],
    truncated: false
  })
  assert.ok(!files.listed.some((path) => path.includes('research')))
})

test('change files stop at the cap', async () => {
  const dir = `${ROOT}/changes/big`
  const tree: Record<string, string> = {}
  for (let index = 0; index < MAX_FILES + 5; index += 1) {
    tree[`${dir}/note-${String(index).padStart(3, '0')}.md`] = ''
  }
  const result = await listChangeFiles(fakeFiles(tree), ROOT, 'big', [])
  assert.equal(result.files.length, MAX_FILES)
  assert.equal(result.truncated, true)
})
