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
