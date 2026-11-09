import { assert, test } from 'orca/testing'
import { belongsTo, placeApply, type PlacedWorkspace } from './apply-target'

const workspace = (id: string, name: string, kind: PlacedWorkspace['kind'] = 'folder', branch: string | null = null) => ({
  id,
  kind,
  name,
  branch
})

const card = (name: string, key: string | null) => ({
  name,
  ticket: key ? { key, url: null } : null,
  apply: { kind: 'here' as const }
})

test('a workspace belongs to a change by its ticket key or its change name, as a whole key', () => {
  assert.equal(belongsTo(workspace('w', 'PROJ-7'), card('proj-7-dark-mode', 'PROJ-7')), true)
  assert.equal(belongsTo(workspace('w', 'PROJ-71'), card('proj-7-dark-mode', 'PROJ-7')), false)
  assert.equal(belongsTo(workspace('w', 'main', 'worktree', 'feature/add-dark-mode'), card('add-dark-mode', null)), true)
  assert.equal(belongsTo(workspace('w', 'overview'), card('add-dark-mode', null)), false)
})

test('Apply stays here only in the change own workspace', () => {
  const focused = workspace('w1', 'PROJ-7')
  const others = [workspace('w2', 'PROJ-9'), workspace('w3', 'PROJ-9-api-fix', 'worktree')]
  assert.deepEqual(placeApply(card('proj-7-dark-mode', 'PROJ-7'), focused, others, false), { kind: 'here' })
  assert.deepEqual(placeApply(card('proj-9-api', 'PROJ-9'), focused, others, false), {
    kind: 'elsewhere',
    workspaceId: 'w2',
    workspaceName: 'PROJ-9'
  })
  const missing = placeApply(card('proj-5-old', 'PROJ-5'), focused, others, false)
  assert.equal(missing.kind, 'none')
})

test('applyAnywhere keeps the old behaviour, and a blocked change stays blocked', () => {
  const focused = workspace('w1', 'overview')
  assert.deepEqual(placeApply(card('proj-9-api', 'PROJ-9'), focused, [], true), { kind: 'here' })
  const blocked = { ...card('proj-9-api', 'PROJ-9'), apply: { kind: 'none' as const, reason: null } }
  assert.deepEqual(placeApply(blocked, focused, [], false), { kind: 'none', reason: null })
})
