import { assert, test } from 'orca/testing'
import { listChangeFiles, listChanges, MAX_FILES, readCard, stageOf } from './changes'
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
    complete: 'pullRequests',
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
  const card = await readCard(files, ROOT, 'proj-7-dark-mode', ours, [pr('open')])
  assert.equal(card.stage, 'in-review')
  assert.equal(card.resume, 'wire the toggle')
  assert.deepEqual(card.ticket, { key: 'PROJ-7', url: 'https://tracker.example.com/browse/PROJ-7' })
  assert.deepEqual(card.apply, { kind: 'here' })
})

test('a change without a ticket cannot be applied when the command needs one', async () => {
  const dir = `${ROOT}/changes/tidy-up`
  const files = fakeFiles({ [`${dir}/proposal.md`]: '', [`${dir}/design.md`]: '', [`${dir}/tasks.md`]: '- [ ] one\n' })
  const card = await readCard(files, ROOT, 'tidy-up', { ...ours, apply: '/work {ticket}' }, null)
  assert.equal(card.stage, 'ready')
  assert.equal(card.apply.kind, 'none')
})

test('stage table', () => {
  const tasks = (done: number, total: number) => ({ done, total })
  const cases: [Parameters<typeof stageOf>[0], string][] = [
    [{ missing: ['design.md'], tasks: tasks(3, 3), pullRequests: [pr('merged')], complete: 'pullRequests' }, 'planning'],
    [{ missing: [], tasks: tasks(0, 4), pullRequests: null, complete: 'ticks' }, 'ready'],
    [{ missing: [], tasks: tasks(2, 4), pullRequests: null, complete: 'ticks' }, 'in-progress'],
    [{ missing: [], tasks: tasks(4, 4), pullRequests: null, complete: 'ticks' }, 'complete'],
    [{ missing: [], tasks: tasks(2, 4), pullRequests: [pr('open')], complete: 'ticks' }, 'in-review'],
    [{ missing: [], tasks: tasks(4, 4), pullRequests: [], complete: 'pullRequests' }, 'in-progress'],
    [{ missing: [], tasks: tasks(1, 4), pullRequests: [pr('merged'), pr('open')], complete: 'pullRequests' }, 'in-review'],
    [{ missing: [], tasks: tasks(1, 4), pullRequests: [pr('merged'), pr('closed')], complete: 'pullRequests' }, 'complete'],
    [{ missing: [], tasks: tasks(1, 4), pullRequests: [pr('closed')], complete: 'pullRequests' }, 'in-progress']
  ]
  for (const [input, expected] of cases) {
    assert.equal(stageOf(input), expected, JSON.stringify(input))
  }
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
