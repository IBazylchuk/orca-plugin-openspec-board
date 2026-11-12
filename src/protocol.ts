export type Stage = 'planning' | 'ready' | 'in-progress' | 'in-review' | 'merged' | 'complete'

export type CommandName = 'apply' | 'finish'

export interface Command {
  name: CommandName
  text: string
}

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

export interface Spend {
  key: string
  runs: number
  costUsd: number
  inputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
  durationMs: number
  checkFailures: number
  escalated: number
}

export interface ChangeSpend {
  total: Spend
  byModel: Spend[]
}

export interface ChangeSpendDetail extends ChangeSpend {
  byTask: Spend[]
  byAgent: Spend[]
}

export interface SpendMonth {
  month: string
  total: Spend
  byModel: Spend[]
}

export interface SpendHistory {
  months: SpendMonth[]
  total: Spend
  byModel: Spend[]
}

export interface ChangeCard {
  name: string
  stage: Stage
  missing: string[]
  tasks: Count
  resume: string | null
  ticket: Ticket | null
  pullRequests: PullRequest[] | null
  pullRequestsUnknown: boolean
  spend: ChangeSpend | null
  inThisWorkspace: boolean
  commands: Command[]
  place: Place
}

export type Place =
  | { kind: 'here' }
  | { kind: 'elsewhere'; workspaceId: string; workspaceName: string }
  | { kind: 'new'; workspaceName: string }
  | { kind: 'none'; reason: string | null }

export interface TaskItem {
  text: string
  done: boolean
}

export interface TaskSection {
  title: string
  tasks: TaskItem[]
}

export interface BoardSnapshot {
  workspaceId: string | null
  changes: ChangeCard[]
  problems: string[]
  spendEnabled: boolean
  pullRequestsPending: boolean
  checkedAt: number
}

export interface ChangeRef {
  workspaceId: string
  change: string
}

declare module 'orca' {
  interface PluginRequests {
    'board.get': { input: { fresh?: boolean } | undefined; output: BoardSnapshot }
    'board.pullRequests': { input: { fresh?: boolean } | undefined; output: BoardSnapshot }
    'change.files': { input: ChangeRef; output: { files: string[]; truncated: boolean } }
    'change.read': { input: ChangeRef & { path: string }; output: { text: string | null } }
    'change.edit': { input: ChangeRef & { path: string }; output: { opened: boolean; message: string } }
    'change.run': {
      input: ChangeRef & { command: CommandName; terminalId: string }
      output: { sent: boolean; message: string }
    }
    'change.start': {
      input: ChangeRef & { command: CommandName }
      output: { started: boolean; message: string }
    }
    'change.spend': { input: ChangeRef; output: { spend: ChangeSpendDetail | null } }
    'spend.history': { input: undefined; output: { history: SpendHistory | null } }
    'workspace.go': { input: { workspaceId: string }; output: { opened: boolean; message: string } }
    'change.tasks': { input: ChangeRef; output: { sections: TaskSection[] | null } }
    'task.run': {
      input: ChangeRef & { task: string; terminalId: string }
      output: { sent: boolean; message: string }
    }
  }
  interface PluginPanelEvents {
    'board.changed': { at: number }
  }
}
