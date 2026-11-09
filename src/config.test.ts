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
      complete: 'pullRequests',
      resumeLine: '^Next:',
      ticket: { pattern: '^proj-(\\d+)', key: 'PROJ-$1', url: 'https://tracker.example.com/browse/{ticket}' },
      pullRequests: { owner: 'example-org' },
      apply: '/work {ticket}',
      files: { exclude: ['research'] }
    })
  )
  assert.deepEqual(problems, [])
  assert.deepEqual(config.requiredArtifacts, ['proposal.md', 'tasks.md'])
  assert.equal(config.complete, 'pullRequests')
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
      files: { exclude: 'research' }
    })
  )
  assert.equal(problems.length, 6)
  assert.deepEqual(config.requiredArtifacts, DEFAULT_CONFIG.requiredArtifacts)
  assert.equal(config.ticket, null)
  assert.equal(config.pullRequests, null)
})

test('completion by pull requests without a ticket rule falls back to ticks', () => {
  const { config, problems } = parseConfig(JSON.stringify({ complete: 'pullRequests' }))
  assert.equal(config.complete, 'ticks')
  assert.equal(problems.length, 1)
})
