import { assert, test } from 'orca/testing'
import { DEFAULT_CONFIG, parseConfig } from './config'

test('no board.json keeps plain OpenSpec defaults', () => {
  assert.deepEqual(parseConfig(null), { config: DEFAULT_CONFIG, problems: [] })
})

test('broken JSON reports a problem and keeps the defaults', () => {
  const { config, problems } = parseConfig('{ not json')
  assert.deepEqual(config, DEFAULT_CONFIG)
  assert.equal(problems.length, 1)
})

test('a full config is read', () => {
  const { config, problems } = parseConfig(
    JSON.stringify({
      requiredArtifacts: ['proposal.md', 'tasks.md'],
      resumeLine: '^Next:',
      ticket: { pattern: '^proj-(\\d+)', key: 'PROJ-$1', url: 'https://tracker.example.com/browse/{ticket}' },
      pullRequests: { owner: 'example-org' },
      apply: '/work {ticket}',
      finish: '/close {ticket}',
      task: '/work {ticket} only {task}',
      agent: 'codex',
      files: { exclude: ['research'] }
    })
  )
  assert.deepEqual(problems, [])
  assert.deepEqual(config.requiredArtifacts, ['proposal.md', 'tasks.md'])
  assert.equal(config.finish, '/close {ticket}')
  assert.equal(config.agent, 'codex')
  assert.equal(config.task, '/work {ticket} only {task}')
  assert.equal(config.pullRequests?.search, '{ticket}')
  assert.equal(config.apply, '/work {ticket}')
  assert.deepEqual(config.exclude, ['research'])
})

test('invalid fields are reported one by one and fall back', () => {
  const { config, problems } = parseConfig(
    JSON.stringify({
      requiredArtifacts: ['../outside'],
      complete: 'never',
      resumeLine: '(',
      ticket: { pattern: '^x', key: 'X', url: 'javascript:alert(1)' },
      pullRequests: { owner: 'bad owner' },
      agent: 'claude; rm -rf ~',
      files: { exclude: 'research' }
    })
  )
  assert.equal(problems.length, 7)
  assert.equal(config.agent, 'claude')
  assert.deepEqual(config.requiredArtifacts, DEFAULT_CONFIG.requiredArtifacts)
  assert.equal(config.ticket, null)
  assert.equal(config.pullRequests, null)
})

test('the old complete setting is reported as no longer read', () => {
  const { config, problems } = parseConfig(JSON.stringify({ complete: 'pullRequests' }))
  assert.deepEqual(config, DEFAULT_CONFIG)
  assert.equal(problems.length, 1)
})

test('agent runs are off unless runs is configured', () => {
  assert.equal(parseConfig(null).config.runs, null)
  assert.equal(parseConfig('{}').config.runs, null)
  assert.deepEqual(parseConfig('{"runs": false}'), { config: DEFAULT_CONFIG, problems: [] })
})

test('runs: true reads the default file and no folders', () => {
  const { config, problems } = parseConfig('{"runs": true}')
  assert.deepEqual(problems, [])
  assert.deepEqual(config.runs, { file: 'agent-runs.jsonl', folders: [] })
})

test('runs reads its own file name and folders', () => {
  const { config, problems } = parseConfig(JSON.stringify({ runs: { file: 'spend.jsonl', folders: ['tmp/agent-runs', 'logs'] } }))
  assert.deepEqual(problems, [])
  assert.deepEqual(config.runs, { file: 'spend.jsonl', folders: ['tmp/agent-runs', 'logs'] })
})

test('a runs file outside the change or a folder leaving the workspace is a problem', () => {
  const unsafeFile = parseConfig(JSON.stringify({ runs: { file: '../runs.jsonl' } }))
  assert.equal(unsafeFile.problems.length, 1)
  assert.equal(unsafeFile.config.runs?.file, 'agent-runs.jsonl')
  for (const folder of ['../outside', '/etc', 'a/../b', 'a//b', './a', 'a/', 'a\\b', '']) {
    const { config, problems } = parseConfig(JSON.stringify({ runs: { folders: [folder] } }))
    assert.equal(problems.length, 1, folder)
    assert.deepEqual(config.runs?.folders, [], folder)
  }
  assert.equal(parseConfig(JSON.stringify({ runs: { folders: 'tmp' } })).problems.length, 1)
})

test('runs of another kind is a problem and leaves the feature off', () => {
  for (const runs of ['yes', 3, ['x'], null]) {
    const { config, problems } = parseConfig(JSON.stringify({ runs }))
    assert.equal(problems.length, 1)
    assert.equal(config.runs, null)
  }
})
