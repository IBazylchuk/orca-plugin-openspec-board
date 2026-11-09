import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Heading,
  host,
  Link,
  Markdown,
  on,
  plugin,
  Progress,
  read,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext,
  type Tone
} from 'orca'
import type { BoardSnapshot, ChangeCard, ChangeRef, PullRequest, Stage } from './protocol'

const REQUEST = { timeoutMs: 60_000 }

export const STAGES: { stage: Stage; title: string; tone: Tone }[] = [
  { stage: 'planning', title: 'Planning', tone: 'neutral' },
  { stage: 'ready', title: 'Ready', tone: 'accent' },
  { stage: 'in-progress', title: 'In progress', tone: 'warning' },
  { stage: 'in-review', title: 'In review', tone: 'accent' },
  { stage: 'complete', title: 'Complete', tone: 'success' }
]

const PR_TONE: Record<PullRequest['state'], Tone> = { open: 'accent', merged: 'success', closed: 'neutral' }

type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  working: 'busy',
  blocked: 'needs your approval',
  waiting: 'waiting for you',
  done: 'finished'
}

const READY_AGENT_STATES = new Set<AgentState>(['waiting', 'done'])

interface AgentOption {
  value: string
  label: string
  state: AgentState
}

const snapshot = atom<BoardSnapshot | null>(null)
const failure = atom<string | null>(null)
const notice = atom<string | null>(null)
const agents = atom<AgentOption[]>([])
const workspaceName = atom<string | null>(null)
const agentChoice = atom('agent', '', { persist: 'workspace' })
const opened = atom<ChangeRef | null>(null)
const files = atom<{ files: string[]; truncated: boolean } | null>(null)
const fileChoice = atom('')
const fileText = atom<string | null>(null)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function load(fresh = false): Promise<void> {
  try {
    set(snapshot, await plugin.request('board.get', { fresh }, REQUEST))
    set(failure, null)
  } catch (error) {
    set(failure, messageOf(error))
  }
}

const LEADING_STATUS_GLYPHS = /^[^\p{L}\p{N}]+/u
const TRAILING_STATE = /:\s*(working|done|waiting|blocked|idle)\b.*$/i

export const cleanTitle = (title: string | null | undefined): string =>
  (title ?? '').replace(LEADING_STATUS_GLYPHS, '').replace(TRAILING_STATE, '').trim()

const agentKind = (agent: string | null): string =>
  agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : 'Agent'

async function loadAgents(): Promise<void> {
  try {
    const [{ agents: listed }, context] = await Promise.all([
      host.call('agents.list'),
      host.call('workspace.readContext')
    ])
    set(workspaceName, context?.displayName ?? null)
    const terminalTitles = new Map((context?.terminals ?? []).map((terminal) => [terminal.id, terminal.title]))
    const options = listed.flatMap((agent): AgentOption[] => {
      if (!agent.terminalId) {
        return []
      }
      const title = cleanTitle(terminalTitles.get(agent.terminalId) ?? agent.title)
      const named = title ? ` — "${title}"` : ''
      return [
        {
          value: agent.terminalId,
          label: `${agentKind(agent.agent)}, ${AGENT_STATE_LABEL[agent.state]}${named}`,
          state: agent.state
        }
      ]
    })
    set(agents, options)
    if (!options.some((option) => option.value === read(agentChoice))) {
      set(agentChoice, options.length === 1 ? options[0].value : '')
    }
  } catch {
    set(agents, [])
  }
}

async function choose(ref: ChangeRef, path: string): Promise<void> {
  set(fileChoice, path)
  set(fileText, null)
  try {
    const { text } = await plugin.request('change.read', { ...ref, path }, REQUEST)
    if (read(fileChoice) === path) {
      set(fileText, text ?? '')
    }
  } catch (error) {
    set(notice, messageOf(error))
  }
}

async function open(ref: ChangeRef): Promise<void> {
  set(opened, ref)
  set(files, null)
  set(fileChoice, '')
  set(fileText, null)
  set(notice, null)
  try {
    const listed = await plugin.request('change.files', ref, REQUEST)
    set(files, listed)
    if (listed.files[0]) {
      await choose(ref, listed.files[0])
    }
  } catch (error) {
    set(notice, messageOf(error))
  }
}

async function edit(ref: ChangeRef, path: string): Promise<void> {
  try {
    set(notice, (await plugin.request('change.edit', { ...ref, path }, REQUEST)).message)
  } catch (error) {
    set(notice, messageOf(error))
  }
}

async function apply(ref: ChangeRef): Promise<void> {
  try {
    const result = await plugin.request('change.apply', { ...ref, terminalId: read(agentChoice) }, REQUEST)
    set(notice, result.message)
  } catch (error) {
    set(notice, messageOf(error))
  }
}

const SETTLED_AGENT_STATES = new Set(['waiting', 'done'])

export function setup(ctx: PanelContext): void {
  void load()
  void loadAgents()
  ctx.subscriptions.push(
    on('workspace.changed', () => {
      set(opened, null)
      void load()
      void loadAgents()
    }),
    on('agent.status.changed', ({ state }) => {
      void loadAgents()
      if (SETTLED_AGENT_STATES.has(state)) {
        void load()
      }
    })
  )
}

const chosenAgent = (): AgentOption | undefined => read(agents).find((agent) => agent.value === read(agentChoice))

const applyBlocker = (): string | null => {
  const agent = chosenAgent()
  if (!agent) {
    return 'Pick an agent first'
  }
  return READY_AGENT_STATES.has(agent.state) ? null : `The agent is ${AGENT_STATE_LABEL[agent.state]}; Apply waits until it stops`
}

function AgentPicker() {
  const options = read(agents)
  const name = read(workspaceName)
  const here = name ? `"${name}"` : 'the workspace Orca shows'
  if (options.length === 0) {
    return <Text muted size="xs">{`No agent runs in ${here}; start one to apply a change.`}</Text>
  }
  const blocker = read(agentChoice) ? applyBlocker() : null
  return (
    <Stack gap="xs">
      <Select
        label={`Apply sends the command to an agent of ${here}`}
        value={read(agentChoice)}
        placeholder="Pick an agent of this workspace"
        options={options.map(({ value, label }) => ({ value, label }))}
        onChange={(value) => set(agentChoice, value)}
      />
      {blocker ? <Text muted size="xs">{blocker}</Text> : null}
    </Stack>
  )
}

function PullRequests({ change }: { change: ChangeCard }) {
  if (change.pullRequests === null || change.pullRequests.length === 0) {
    return null
  }
  const open = change.pullRequests.filter((pr) => pr.state === 'open')
  const finished = (['merged', 'closed'] as const).flatMap((state) => {
    const count = change.pullRequests?.filter((pr) => pr.state === state).length ?? 0
    return count > 0 ? [`${count} ${state}`] : []
  })
  return (
    <Stack gap="xs">
      {open.map((pr) => (
        <Row key={pr.url} gap="xs">
          <Badge tone={PR_TONE.open}>{pr.draft ? 'draft' : 'open'}</Badge>
          <Link href={pr.url}>{`${pr.repository.split('/').pop()}#${pr.number}`}</Link>
          <Text muted size="xs" truncate>
            {pr.title}
          </Text>
        </Row>
      ))}
      {finished.length > 0 ? <Text muted size="xs">{`Pull requests: ${finished.join(', ')}`}</Text> : null}
    </Stack>
  )
}

function ChangeItem({ workspaceId, change }: { workspaceId: string; change: ChangeCard }) {
  const ref = { workspaceId, change: change.name }
  const progress = change.tasks.total > 0 ? Math.round((change.tasks.done / change.tasks.total) * 100) : 0
  return (
    <Card title={change.name}>
      <Stack gap="xs">
        <Row gap="xs" wrap>
          {change.ticket ? (
            change.ticket.url ? <Link href={change.ticket.url}>{change.ticket.key}</Link> : <Badge>{change.ticket.key}</Badge>
          ) : null}
          <Text muted size="xs">
            {change.tasks.total > 0 ? `${change.tasks.done} of ${change.tasks.total} tasks` : 'No tasks yet'}
          </Text>
        </Row>
        {change.tasks.total > 0 ? <Progress label={`${change.name} tasks`} labelHidden value={progress} /> : null}
        {change.resume ? <Text size="sm">{`Next: ${change.resume}`}</Text> : null}
        {change.missing.length > 0 ? <Text muted size="xs">{`Missing: ${change.missing.join(', ')}`}</Text> : null}
        <PullRequests change={change} />
        <Row gap="xs">
          <Button size="sm" variant="outline" icon="file-text" onPress={() => open(ref)}>
            Open
          </Button>
          {change.applicable ? (
            <Button
              size="sm"
              icon="play"
              disabled={applyBlocker() !== null}
              tooltip={applyBlocker() ?? undefined}
              onPress={() => apply(ref)}
            >
              Apply
            </Button>
          ) : null}
        </Row>
      </Stack>
    </Card>
  )
}

function Board({ board }: { board: BoardSnapshot }) {
  const workspaceId = board.workspaceId
  if (!workspaceId || board.changes.length === 0) {
    return board.problems.length > 0 ? null : (
      <EmptyState icon="info" title="No changes" description="openspec/changes holds no active change." />
    )
  }
  return (
    <Stack gap="md">
      {STAGES.map(({ stage, title, tone }) => {
        const changes = board.changes.filter((change) => change.stage === stage)
        return changes.length === 0 ? null : (
          <Stack key={stage} gap="sm">
            <Row gap="xs">
              <Heading level={3}>{title}</Heading>
              <Badge tone={tone}>{String(changes.length)}</Badge>
            </Row>
            {changes.map((change) => (
              <ChangeItem key={change.name} workspaceId={workspaceId} change={change} />
            ))}
          </Stack>
        )
      })}
    </Stack>
  )
}

function FileView({ change }: { change: ChangeRef }) {
  const listed = read(files)
  const path = read(fileChoice)
  const text = read(fileText)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Button variant="ghost" icon="close" onPress={() => set(opened, null)}>
          Back to board
        </Button>
        {path ? (
          <Button variant="outline" icon="edit" onPress={() => edit(change, path)}>
            Open in editor
          </Button>
        ) : null}
      </Row>
      <Heading level={2}>{change.change}</Heading>
      {read(notice) ? <Text muted>{read(notice)}</Text> : null}
      {listed === null ? (
        <Spinner label="Listing files" />
      ) : listed.files.length === 0 ? (
        <EmptyState icon="info" title="No markdown files" />
      ) : (
        <Select
          label="File"
          value={path}
          options={listed.files.map((file) => ({ value: file, label: file }))}
          onChange={(value) => choose(change, value)}
        />
      )}
      {listed?.truncated ? <Text muted size="xs">Only the first files are listed.</Text> : null}
      {path && text === null ? <Spinner label="Reading the file" /> : null}
      {text !== null ? <Markdown content={text} /> : null}
    </Stack>
  )
}

export default function Panel() {
  const change = read(opened)
  if (change) {
    return <FileView change={change} />
  }
  const board = read(snapshot)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>OpenSpec</Heading>
        <Button variant="ghost" icon="refresh" onPress={() => load(true)}>
          Refresh
        </Button>
      </Row>
      {read(failure) ? <Text tone="danger">{read(failure)}</Text> : null}
      {board?.problems.map((problem) => (
        <Callout key={problem} tone="warning">
          {problem}
        </Callout>
      ))}
      {read(notice) ? <Text muted>{read(notice)}</Text> : null}
      {board && board.changes.length > 0 ? <AgentPicker /> : null}
      {board ? <Board board={board} /> : read(failure) ? null : <Spinner label="Reading OpenSpec changes" />}
    </Stack>
  )
}
