import { assert, test } from 'orca/testing'
import { belongsTo, placeChange, type PlacedWorkspace } from './apply-target'

const workspace = (id: string, name: string, kind: PlacedWorkspace['kind'] = 'folder', branch: string | null = null) => ({
  id,
  kind,
  name,
  branch
})

const card = (name: string, key: string | null) => ({
  name,
  ticket: key ? { key, url: null } : null,
  place: { kind: 'here' as const }
})

const placement = (focused: PlacedWorkspace, seeing: PlacedWorkspace[], canCreate = false) => ({
  focused,
  seeing,
  applyAnywhere: false,
  canCreate
})

test('a workspace belongs to a change by its ticket key or its change name, as a whole key', () => {
  assert.equal(belongsTo(workspace('w', 'PROJ-7'), card('proj-7-dark-mode', 'PROJ-7')), true)
  assert.equal(belongsTo(workspace('w', 'PROJ-71'), card('proj-7-dark-mode', 'PROJ-7')), false)
  assert.equal(belongsTo(workspace('w', 'main', 'worktree', 'feature/add-dark-mode'), card('add-dark-mode', null)), true)
  assert.equal(belongsTo(workspace('w', 'overview'), card('add-dark-mode', null)), false)
})

test('a change runs here only in its own workspace, and goes to its own workspace from elsewhere', () => {
  const focused = workspace('w1', 'PROJ-7')
  const seeing = [workspace('w2', 'PROJ-9'), workspace('w3', 'PROJ-9-api-fix', 'worktree')]
  assert.deepEqual(placeChange(card('proj-7-dark-mode', 'PROJ-7'), placement(focused, seeing)), { kind: 'here' })
  assert.deepEqual(placeChange(card('proj-9-api', 'PROJ-9'), placement(focused, seeing)), {
    kind: 'elsewhere',
    workspaceId: 'w2',
    workspaceName: 'PROJ-9'
  })
})

test('without its own workspace a change offers a new one, if the focused workspace is a folder', () => {
  const focused = workspace('w1', 'PROJ-7')
  assert.deepEqual(placeChange(card('proj-5-old', 'PROJ-5'), placement(focused, [], true)), {
    kind: 'new',
    workspaceName: 'PROJ-5'
  })
  assert.deepEqual(placeChange(card('proj-5-old', 'PROJ-5'), placement(focused, [], false)), {
    kind: 'none',
    reason: "Runs in the change's own workspace: create one named PROJ-5 in Orca"
  })
  assert.equal(placeChange(card('two words', null), placement(focused, [], true)).kind, 'none')
})

test('applyAnywhere keeps the old behaviour, and a blocked change stays blocked', () => {
  const focused = workspace('w1', 'overview')
  assert.deepEqual(placeChange(card('proj-9-api', 'PROJ-9'), { ...placement(focused, []), applyAnywhere: true }), {
    kind: 'here'
  })
  const blocked = { ...card('proj-9-api', 'PROJ-9'), place: { kind: 'none' as const, reason: null } }
  assert.deepEqual(placeChange(blocked, placement(focused, [], true)), { kind: 'none', reason: null })
})
