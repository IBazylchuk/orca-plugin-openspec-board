import { defineCheck } from 'orca/testing'
import type { BoardSnapshot, ChangeCard, PullRequest } from './protocol'

const TRACKER = 'https://tracker.example.com/browse/'
const REPO = 'example-org/notes'

const ticket = (key: string) => ({ key, url: `${TRACKER}${key}` })

const pr = (number: number, state: PullRequest['state'], title: string, draft = false): PullRequest => ({
  repository: REPO,
  number,
  state,
  draft,
  title,
  url: `https://github.com/${REPO}/pull/${number}`
})

const apply = (key: string) => ({ name: 'apply' as const, text: `/work ${key}` })
const finish = (key: string) => ({ name: 'finish' as const, text: `/close ${key}` })

const DEMO_CHANGES: ChangeCard[] = [
  {
    name: 'note-31-shared-folders',
    stage: 'planning',
    missing: ['design.md', 'tasks.md'],
    tasks: { done: 0, total: 0 },
    resume: null,
    ticket: ticket('NOTE-31'),
    pullRequests: null,
    pullRequestsUnknown: false,
    inThisWorkspace: false,
    commands: [],
    place: { kind: 'none', reason: null }
  },
  {
    name: 'note-27-export-to-pdf',
    stage: 'ready',
    missing: [],
    tasks: { done: 0, total: 9 },
    resume: 'pick the PDF library from the two in design.md, then 1.1.',
    ticket: ticket('NOTE-27'),
    pullRequests: [],
    pullRequestsUnknown: false,
    inThisWorkspace: false,
    commands: [apply('NOTE-27')],
    place: { kind: 'new', workspaceName: 'NOTE-27' }
  },
  {
    name: 'note-42-offline-sync',
    stage: 'in-progress',
    missing: [],
    tasks: { done: 7, total: 16 },
    resume: 'conflict resolution for edits made on two devices (section 3).',
    ticket: ticket('NOTE-42'),
    pullRequests: [pr(118, 'merged', 'NOTE-42: local change queue')],
    pullRequestsUnknown: false,
    inThisWorkspace: true,
    commands: [apply('NOTE-42')],
    place: { kind: 'here' }
  },
  {
    name: 'note-19-tag-autocomplete',
    stage: 'in-progress',
    missing: [],
    tasks: { done: 3, total: 8 },
    resume: 'rank suggestions by recent use, then 2.4.',
    ticket: ticket('NOTE-19'),
    pullRequests: [],
    pullRequestsUnknown: false,
    inThisWorkspace: false,
    commands: [apply('NOTE-19')],
    place: { kind: 'elsewhere', workspaceId: 'w-19', workspaceName: 'NOTE-19' }
  },
  {
    name: 'note-36-dark-mode',
    stage: 'in-review',
    missing: [],
    tasks: { done: 11, total: 12 },
    resume: 'address the review on contrast in the sidebar.',
    ticket: ticket('NOTE-36'),
    pullRequests: [pr(124, 'open', 'NOTE-36: dark theme tokens'), pr(121, 'merged', 'NOTE-36: theme switcher')],
    pullRequestsUnknown: false,
    inThisWorkspace: false,
    commands: [apply('NOTE-36'), finish('NOTE-36')],
    place: { kind: 'elsewhere', workspaceId: 'w-36', workspaceName: 'NOTE-36' }
  },
  {
    name: 'note-12-search-index',
    stage: 'merged',
    missing: [],
    tasks: { done: 14, total: 17 },
    resume: 'measure search latency on the large sample after release.',
    ticket: ticket('NOTE-12'),
    pullRequests: [pr(97, 'merged', 'NOTE-12: search index'), pr(103, 'merged', 'NOTE-12: reindex job')],
    pullRequestsUnknown: false,
    inThisWorkspace: false,
    commands: [finish('NOTE-12')],
    place: { kind: 'new', workspaceName: 'NOTE-12' }
  },
  {
    name: 'note-8-markdown-tables',
    stage: 'complete',
    missing: [],
    tasks: { done: 6, total: 6 },
    resume: null,
    ticket: ticket('NOTE-8'),
    pullRequests: [pr(88, 'merged', 'NOTE-8: markdown tables')],
    pullRequestsUnknown: false,
    inThisWorkspace: false,
    commands: [finish('NOTE-8')],
    place: { kind: 'new', workspaceName: 'NOTE-8' }
  }
]

const DEMO_BOARD: BoardSnapshot = { workspaceId: 'w-42', changes: DEMO_CHANGES, problems: [], checkedAt: 0 }

const DEMO_PROPOSAL = `# Offline sync

## Why

Notes written on a train or a plane are lost when the app closes before it reconnects.

## What changes

- Edits made offline go into a local change queue and are sent once the device is back online.
- Two devices editing the same note keep both versions until the person picks one.

## Impact

- Sync service, the local store and the editor toolbar.
`

const demo = {
  results: {
    'workspace.readContext': {
      branch: 'main',
      displayName: 'NOTE-42',
      terminals: [{ id: 't1', title: 'notes-web' }]
    },
    'agents.list': {
      agents: [{ terminalId: 't1', title: 'notes-web', agent: 'claude', state: 'waiting', stateStartedAt: 0 }]
    }
  },
  requests: {
    'board.get': () => DEMO_BOARD,
    'change.files': () => ({
      files: ['proposal.md', 'design.md', 'tasks.md', 'specs/sync/spec.md'],
      truncated: false
    }),
    'change.read': () => ({ text: DEMO_PROPOSAL })
  }
}

const UNPINNED_BOARD: BoardSnapshot = {
  ...DEMO_BOARD,
  changes: DEMO_CHANGES.map((change) => ({ ...change, inThisWorkspace: false }))
}

const showing = (stage: string) => ({
  ...demo,
  requests: { ...demo.requests, 'board.get': () => UNPINNED_BOARD },
  persisted: { workspace: { stage, agent: 't1' } }
})

export default defineCheck({
  noFocusedWorkspace: {},
  emptyProject: {
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'app', terminals: [] },
      'workspace.list': { workspaces: [], truncated: false }
    }
  },
  demo,
  demoInReview: showing('in-review'),
  demoMerged: showing('merged')
})
