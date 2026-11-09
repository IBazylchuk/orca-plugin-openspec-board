import { mentionsKey } from './pull-requests'
import type { ApplyTarget, ChangeCard } from './protocol'

export interface PlacedWorkspace {
  id: string
  kind: 'worktree' | 'folder'
  name: string
  branch: string | null
}

export function belongsTo(workspace: PlacedWorkspace, card: Pick<ChangeCard, 'name' | 'ticket'>): boolean {
  const keys = [card.ticket?.key, card.name].filter((key): key is string => Boolean(key))
  const labels = [workspace.name, workspace.branch ?? '']
  return keys.some((key) => labels.some((label) => mentionsKey(label, key)))
}

const ownWorkspaceFirst = (key: string | undefined) => (a: PlacedWorkspace, b: PlacedWorkspace): number => {
  const rank = (workspace: PlacedWorkspace): number =>
    (workspace.name === key ? 0 : 2) + (workspace.kind === 'folder' ? 0 : 1)
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
}

export function placeApply(
  card: Pick<ChangeCard, 'name' | 'ticket' | 'apply'>,
  focused: PlacedWorkspace,
  workspaces: PlacedWorkspace[],
  applyAnywhere: boolean
): ApplyTarget {
  if (card.apply.kind !== 'here' || applyAnywhere || belongsTo(focused, card)) {
    return card.apply
  }
  const own = workspaces
    .filter((workspace) => workspace.id !== focused.id && belongsTo(workspace, card))
    .sort(ownWorkspaceFirst(card.ticket?.key))[0]
  if (own) {
    return { kind: 'elsewhere', workspaceId: own.id, workspaceName: own.name }
  }
  const key = card.ticket?.key ?? card.name
  return { kind: 'none', reason: `Apply runs in the change's own workspace: create one named ${key} in Orca` }
}
