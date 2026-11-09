import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Collapsible,
  EmptyState,
  Heading,
  host,
  IconButton,
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
  Tab,
  Tabs,
  Text,
  type PanelContext,
  type Tone
} from 'orca'
import type { BoardSnapshot, ChangeCard, ChangeRef, Command, CommandName, PullRequest, Stage, TaskSection } from './protocol'

const REQUEST = { timeoutMs: 60_000 }

export const STAGES: { stage: Stage; title: string; tone: Tone }[] = [
  { stage: 'planning', title: 'Planning', tone: 'neutral' },
  { stage: 'ready', title: 'Ready', tone: 'accent' },
  { stage: 'in-progress', title: 'In progress', tone: 'warning' },
  { stage: 'in-review', title: 'In review', tone: 'accent' },
  { stage: 'merged', title: 'Merged, tasks open', tone: 'warning' },
  { stage: 'complete', title: 'Complete', tone: 'success' }
]

export const COMMAND_LABEL: Record<CommandName, string> = { apply: 'Apply', finish: 'Finish' }

const ALL_STAGES = 'all'

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
const stageFilter = atom('stage', ALL_STAGES, { persist: 'workspace' })
const opened = atom<ChangeRef | null>(null)
const files = atom<{ files: string[]; truncated: boolean } | null>(null)
const fileChoice = atom('')
const fileText = atom<string | null>(null)
const tasks = atom<TaskSection[] | null>(null)
const view = atom<'tasks' | 'files'>('tasks')

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
const TRAILING_STATE = /:\s*(working|done|waiting|blocked|idle|needs\s+\w+)\b.*$/i

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

async function loadTasks(ref: ChangeRef): Promise<void> {
  try {
    const { sections } = await plugin.request('change.tasks', ref, REQUEST)
    set(tasks, sections ?? [])
  } catch (error) {
    set(notice, messageOf(error))
  }
}

async function open(ref: ChangeRef): Promise<void> {
  set(opened, ref)
  set(files, null)
  set(fileChoice, '')
  set(fileText, null)
  set(tasks, null)
  set(view, 'tasks')
  set(notice, null)
  try {
    const [listed] = await Promise.all([plugin.request('change.files', ref, REQUEST), loadTasks(ref)])
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

async function run(ref: ChangeRef, command: CommandName): Promise<void> {
  try {
    const result = await plugin.request('change.run', { ...ref, command, terminalId: read(agentChoice) }, REQUEST)
    set(notice, result.message)
  } catch (error) {
    set(notice, messageOf(error))
  }
}

async function start(ref: ChangeRef, command: CommandName): Promise<void> {
  try {
    set(notice, (await plugin.request('change.start', { ...ref, command }, REQUEST)).message)
    await load()
  } catch (error) {
    set(notice, messageOf(error))
  }
}

const SETTLED_AGENT_STATES = new Set(['waiting', 'done'])

export const RECHECK_MS = 30_000

function refreshOpened(): void {
  const change = read(opened)
  if (change) {
    void loadTasks(change)
    if (read(fileChoice)) {
      void choose(change, read(fileChoice))
    }
  }
}

export function setup(ctx: PanelContext): void {
  void load()
  void loadAgents()
  const recheck = setInterval(() => {
    if (read(ctx.visible)) {
      void load()
      refreshOpened()
    }
  }, RECHECK_MS)
  ctx.subscriptions.push(
    { dispose: () => clearInterval(recheck) },
    plugin.on('board.changed', () => {
      void load()
      refreshOpened()
    }),
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
  return READY_AGENT_STATES.has(agent.state)
    ? null
    : `The agent is ${AGENT_STATE_LABEL[agent.state]}; Apply and Finish wait until it stops`
}

function AgentPicker() {
  const options = read(agents)
  const name = read(workspaceName)
  const here = name ? `"${name}"` : 'the workspace Orca shows'
  if (options.length === 0) {
    return <Text muted size="xs">{`No agent runs in ${here}; start one to apply or finish a change here.`}</Text>
  }
  const blocker = read(agentChoice) ? applyBlocker() : null
  return (
    <Stack gap="xs">
      <Select
        label={`Apply and Finish send their command to an agent of ${here}`}
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
  if (change.pullRequestsUnknown) {
    return <Text muted size="xs">Pull requests could not be checked, so the stage ignores them; Refresh to retry.</Text>
  }
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

async function goTo(workspaceId: string): Promise<void> {
  try {
    set(notice, (await plugin.request('workspace.go', { workspaceId }, REQUEST)).message)
  } catch (error) {
    set(notice, messageOf(error))
  }
}

function GoToWorkspace({ workspaceId, name }: { workspaceId: string; name: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      icon="next"
      tooltip={`This change runs in its own workspace, ${name}`}
      onPress={() => goTo(workspaceId)}
    >
      {`Go to ${name}`}
    </Button>
  )
}

const COMMAND_ICON: Record<CommandName, 'play' | 'check'> = { apply: 'play', finish: 'check' }

function CommandButton({ reference, command }: { reference: ChangeRef; command: Command }) {
  const blocker = applyBlocker()
  return (
    <Button
      size="sm"
      icon={COMMAND_ICON[command.name]}
      variant={command.name === 'apply' ? 'solid' : 'outline'}
      disabled={blocker !== null}
      tooltip={blocker ?? `Sends ${command.text}`}
      onPress={() => run(reference, command.name)}
    >
      {COMMAND_LABEL[command.name]}
    </Button>
  )
}

function StartButton({ reference, command, workspace }: { reference: ChangeRef; command: Command; workspace: string }) {
  return (
    <Button
      size="sm"
      icon={COMMAND_ICON[command.name]}
      variant="outline"
      tooltip={`Creates the workspace ${workspace} and starts an agent there with ${command.text}`}
      onPress={() => start(reference, command.name)}
    >
      {`${COMMAND_LABEL[command.name]} in new ${workspace}`}
    </Button>
  )
}

function Actions({ reference, change }: { reference: ChangeRef; change: ChangeCard }) {
  const place = change.place
  switch (place.kind) {
    case 'here':
      return (
        <Row gap="xs" wrap>
          {change.commands.map((command) => (
            <CommandButton key={command.name} reference={reference} command={command} />
          ))}
        </Row>
      )
    case 'elsewhere':
      return <GoToWorkspace workspaceId={place.workspaceId} name={place.workspaceName} />
    case 'new':
      return (
        <Row gap="xs" wrap>
          {change.commands.map((command) => (
            <StartButton key={command.name} reference={reference} command={command} workspace={place.workspaceName} />
          ))}
        </Row>
      )
    case 'none':
      return null
  }
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
        {change.stage === 'merged' ? (
          <Text muted size="xs">
            {`Every pull request is in, but ${change.tasks.total - change.tasks.done} tasks are not ticked. Finish checks what is left.`}
          </Text>
        ) : null}
        <Row gap="xs" wrap>
          <Button size="sm" variant="outline" icon="file-text" onPress={() => open(ref)}>
            Open
          </Button>
          <Actions reference={ref} change={change} />
        </Row>
        {change.place.kind === 'none' && change.place.reason ? (
          <Text muted size="xs">{change.place.reason}</Text>
        ) : null}
      </Stack>
    </Card>
  )
}

function StageFilter({ changes }: { changes: ChangeCard[] }) {
  const chosen = read(stageFilter)
  const pick = (stage: string) => set(stageFilter, chosen === stage ? ALL_STAGES : stage)
  return (
    <Row gap="xs" wrap>
      <Button size="sm" variant={chosen === ALL_STAGES ? 'solid' : 'outline'} onPress={() => set(stageFilter, ALL_STAGES)}>
        {`All ${changes.length}`}
      </Button>
      {STAGES.map(({ stage, title }) => {
        const count = changes.filter((change) => change.stage === stage).length
        return count === 0 ? null : (
          <Button key={stage} size="sm" variant={chosen === stage ? 'solid' : 'outline'} onPress={() => pick(stage)}>
            {`${title} ${count}`}
          </Button>
        )
      })}
    </Row>
  )
}

function Board({ board }: { board: BoardSnapshot }) {
  const workspaceId = board.workspaceId
  if (!workspaceId || board.changes.length === 0) {
    return board.problems.length > 0 ? null : (
      <EmptyState icon="info" title="No changes" description="openspec/changes holds no active change." />
    )
  }
  const chosen = read(stageFilter)
  const pinned = board.changes.filter((change) => change.inThisWorkspace)
  const rest = board.changes.filter((change) => !change.inThisWorkspace)
  const shown = STAGES.some(({ stage }) => stage === chosen && board.changes.some((change) => change.stage === stage))
    ? STAGES.filter(({ stage }) => stage === chosen)
    : STAGES
  return (
    <Stack gap="md">
      {pinned.length > 0 ? (
        <Stack gap="sm">
          <Heading level={3}>This workspace</Heading>
          {pinned.map((change) => (
            <ChangeItem key={change.name} workspaceId={workspaceId} change={change} />
          ))}
        </Stack>
      ) : null}
      <StageFilter changes={board.changes} />
      {shown.map(({ stage, title, tone }) => {
        const changes = rest.filter((change) => change.stage === stage)
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

async function runTask(ref: ChangeRef, task: string): Promise<void> {
  try {
    set(notice, (await plugin.request('task.run', { ...ref, task, terminalId: read(agentChoice) }, REQUEST)).message)
  } catch (error) {
    set(notice, messageOf(error))
  }
}

const runsHere = (ref: ChangeRef): boolean =>
  read(snapshot)?.changes.some((change) => change.name === ref.change && change.place.kind === 'here') ?? false

const doneCount = (section: TaskSection): number => section.tasks.filter((task) => task.done).length

function TaskList({ change }: { change: ChangeRef }) {
  const sections = read(tasks)
  const runnable = runsHere(change)
  const blocker = runnable ? applyBlocker() : null
  if (sections === null) {
    return <Spinner label="Reading tasks.md" />
  }
  if (sections.length === 0) {
    return <EmptyState icon="info" title="No tasks" description="tasks.md holds no checkbox list yet." />
  }
  return (
    <Stack gap="sm">
      {sections.map((section, index) => {
        const done = doneCount(section)
        const title = section.title || 'Tasks'
        return (
          <Collapsible
            key={`${index}-${title}`}
            title={title}
            description={`${done} of ${section.tasks.length} done`}
            defaultOpen={done < section.tasks.length}
          >
            <Stack gap="xs">
              {section.tasks.map((task, taskIndex) => (
                <Row key={taskIndex} gap="xs" align="start">
                  <Checkbox label={task.text} checked={task.done} disabled={task.done} />
                  {runnable && !task.done ? (
                    <IconButton
                      icon="play"
                      size="sm"
                      variant="ghost"
                      label={`Run ${task.text}`}
                      tooltip={blocker ?? 'Send this task alone to the agent'}
                      disabled={blocker !== null}
                      onPress={() => runTask(change, task.text)}
                    />
                  ) : null}
                </Row>
              ))}
            </Stack>
          </Collapsible>
        )
      })}
    </Stack>
  )
}

function Files({ change }: { change: ChangeRef }) {
  const listed = read(files)
  const path = read(fileChoice)
  const text = read(fileText)
  return (
    <Stack gap="md">
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

function FileView({ change }: { change: ChangeRef }) {
  const path = read(fileChoice)
  const showing = read(view)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Button variant="ghost" icon="close" onPress={() => set(opened, null)}>
          Back to board
        </Button>
        {showing === 'files' && path ? (
          <Button variant="outline" icon="edit" onPress={() => edit(change, path)}>
            Open in editor
          </Button>
        ) : null}
        {showing === 'tasks' ? (
          <Button variant="outline" icon="edit" onPress={() => edit(change, 'tasks.md')}>
            Open in editor
          </Button>
        ) : null}
      </Row>
      <Heading level={2}>{change.change}</Heading>
      {read(notice) ? <Text muted>{read(notice)}</Text> : null}
      <Tabs label="Change" value={showing} onChange={(value) => set(view, value === 'files' ? 'files' : 'tasks')}>
        <Tab value="tasks" label="Tasks" icon="check">
          <TaskList change={change} />
        </Tab>
        <Tab value="files" label="Files" icon="file-text">
          <Files change={change} />
        </Tab>
      </Tabs>
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
