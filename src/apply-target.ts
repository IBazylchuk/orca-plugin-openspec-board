import { mentionsKey } from './pull-requests'
import type { ChangeCard, Place } from './protocol'

export interface PlacedWorkspace {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  branch: string | null
}

const WORKSPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

export const ownWorkspaceName = (card: Pick<ChangeCard, 'name' | 'ticket'>): string => card.ticket?.key ?? card.name

export function belongsTo(workspace: PlacedWorkspace, card: Pick<ChangeCard, 'name' | 'ticket'>): boolean {
  const keys = [card.ticket?.key, card.name].filter((key): key is string => Boolean(key))
  const labels = [workspace.name, workspace.branch ?? '']
  return keys.some((key) => labels.some((label) => mentionsKey(label, key)))
}

const ownWorkspaceFirst = (key: string) => (a: PlacedWorkspace, b: PlacedWorkspace): number => {
  const rank = (workspace: PlacedWorkspace): number =>
    (workspace.name === key ? 0 : 2) + (workspace.kind === 'folder' ? 0 : 1)
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
}

export interface Placement {
  focused: PlacedWorkspace
  seeing: PlacedWorkspace[]
  applyAnywhere: boolean
  canCreate: boolean
}

export function placeChange(card: Pick<ChangeCard, 'name' | 'ticket' | 'place'>, placement: Placement): Place {
  const { focused, seeing, applyAnywhere, canCreate } = placement
  if (card.place.kind !== 'here' || applyAnywhere || belongsTo(focused, card)) {
    return card.place
  }
  const name = ownWorkspaceName(card)
  const own = seeing
    .filter((workspace) => workspace.id !== focused.id && belongsTo(workspace, card))
    .sort(ownWorkspaceFirst(name))[0]
  if (own) {
    return { kind: 'elsewhere', workspaceId: own.id, workspaceName: own.name }
  }
  if (canCreate && WORKSPACE_NAME.test(name)) {
    return { kind: 'new', workspaceName: name }
  }
  return { kind: 'none', reason: `Runs in the change's own workspace: create one named ${name} in Orca` }
}
