export type Stage = 'planning' | 'ready' | 'in-progress' | 'in-review' | 'complete'

export interface Count {
  done: number
  total: number
}

export interface PullRequest {
  repository: string
  number: number
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  title: string
  url: string
}

export interface Ticket {
  key: string
  url: string | null
}

export interface ChangeCard {
  name: string
  stage: Stage
  missing: string[]
  tasks: Count
  resume: string | null
  ticket: Ticket | null
  pullRequests: PullRequest[] | null
  apply: ApplyTarget
}

export type ApplyTarget =
  | { kind: 'here' }
  | { kind: 'elsewhere'; workspaceId: string; workspaceName: string }
  | { kind: 'none'; reason: string | null }

export interface BoardSnapshot {
  workspaceId: string | null
  changes: ChangeCard[]
  problems: string[]
  checkedAt: number
}

export interface ChangeRef {
  workspaceId: string
  change: string
}

declare module 'orca' {
  interface PluginRequests {
    'board.get': { input: { fresh?: boolean } | undefined; output: BoardSnapshot }
    'change.files': { input: ChangeRef; output: { files: string[]; truncated: boolean } }
    'change.read': { input: ChangeRef & { path: string }; output: { text: string | null } }
    'change.edit': { input: ChangeRef & { path: string }; output: { opened: boolean; message: string } }
    'change.apply': {
      input: ChangeRef & { terminalId: string }
      output: { sent: boolean; message: string }
    }
    'workspace.go': { input: { workspaceId: string }; output: { opened: boolean; message: string } }
  }
}
