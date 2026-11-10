import type { OrcaWorkerApi } from 'orca/worker'
import { applyText } from './apply'
import { belongsTo, placeChange, type PlacedWorkspace } from './apply-target'
import { CONFIG_FILE, parseConfig, type BoardConfig } from './config'
import { ARCHIVE, listChangeFiles, listChanges, readCard, taskSections, ticketOf, type Files } from './changes'
import { pullRequestFinder, type Runner } from './pull-requests'
import { changeSpendDetail, parseRuns, spendHistory, type RunRow } from './spend'
import type { BoardSnapshot, ChangeCard, ChangeRef, CommandName, PullRequest } from './protocol'

export interface Io extends Files {
  run: Runner
  watch(path: string, onChange: () => void): () => void
}

interface Workspace extends PlacedWorkspace {
  path: string
  hostId: string | null
}

interface Located {
  workspace: Workspace
  others: Workspace[]
  root: string
  config: BoardConfig
  problems: string[]
}

const OPENSPEC = 'openspec'
const RUNS_EXTENSION = '.jsonl'

const isLocal = (workspace: Workspace): boolean => workspace.hostId === null || workspace.hostId === 'local'

const ORCA_CLI = 'orca'

interface CliReply {
  ok?: boolean
  error?: { message?: string }
}

function cliReply(output: string | null): CliReply | null {
  try {
    return output ? (JSON.parse(output) as CliReply) : null
  } catch {
    return null
  }
}

function pickFocused(workspaces: Workspace[], branch: string, displayName: string): Workspace | string {
  const named = workspaces.filter((w) => w.name === displayName)
  const exact = named.filter((w) => (w.branch ?? '') === branch)
  const candidates = exact.length > 0 ? exact : named.length > 0 ? named : workspaces.filter((w) => (w.branch ?? '') === branch)
  const paths = new Set(candidates.map((w) => w.path))
  if (paths.size === 1) {
    return candidates[0]
  }
  return paths.size === 0
    ? 'Orca did not list the focused workspace'
    : 'Several workspaces match the focused one, so the board cannot tell which folder to read'
}

export function register(orca: OrcaWorkerApi, io: Io): () => void {
  const findPullRequests = pullRequestFinder(io.run)
  let current: { located: Located; changes: ChangeCard[] } | null = null
  let watched: { path: string; stop: () => void } | null = null

  function watchChanges(path: string): void {
    if (watched?.path === path) {
      return
    }
    watched?.stop()
    watched = { path, stop: io.watch(path, () => orca.panels.post('board.changed', { at: Date.now() })) }
  }

  async function locate(): Promise<Located | string> {
    const context = await orca.host.call('workspace.readContext')
    if (!context) {
      return 'No workspace is focused'
    }
    const { workspaces } = await orca.host.call('workspace.list')
    const focused = pickFocused(workspaces, context.branch, context.displayName)
    if (typeof focused === 'string') {
      return focused
    }
    if (!isLocal(focused)) {
      return 'Workspaces on another host are not supported yet'
    }
    const root = `${focused.path}/${OPENSPEC}`
    const { config, problems } = parseConfig(await io.text(`${root}/${CONFIG_FILE}`))
    const others = workspaces.filter((w) => w.id !== focused.id && isLocal(w))
    return { workspace: focused, others, root, config, problems }
  }

  async function lookUp(located: Located, names: string[], fresh: boolean): Promise<Map<string, PullRequest[] | null>> {
    const rule = located.config.pullRequests
    const tickets = names.flatMap((name) => ticketOf(name, located.config)?.key ?? [])
    const found = rule && tickets.length > 0 ? await findPullRequests(rule, tickets, fresh) : new Map()
    return new Map(names.map((name) => [name, found.get(ticketOf(name, located.config)?.key ?? '') ?? null]))
  }

  async function seesChange(located: Located, workspace: Workspace, change: string): Promise<boolean> {
    return (
      workspace.path === located.workspace.path ||
      (await io.list(`${workspace.path}/${OPENSPEC}/changes/${change}`)) !== null
    )
  }

  async function place(located: Located, card: ChangeCard): Promise<ChangeCard['place']> {
    const owners = located.others.filter((workspace) => belongsTo(workspace, card))
    const seeing: Workspace[] = []
    for (const workspace of owners) {
      if (await seesChange(located, workspace, card.name)) {
        seeing.push(workspace)
      }
    }
    return placeChange(card, {
      focused: located.workspace,
      seeing,
      applyAnywhere: located.config.applyAnywhere,
      canCreate: located.workspace.kind === 'folder'
    })
  }

  async function board(fresh: boolean): Promise<BoardSnapshot> {
    const located = await locate()
    if (typeof located === 'string') {
      current = null
      return { workspaceId: null, changes: [], problems: [located], spendEnabled: false, checkedAt: Date.now() }
    }
    const names = await listChanges(io, located.root)
    if (names === null) {
      current = null
      return {
        workspaceId: located.workspace.id,
        changes: [],
        problems: [...located.problems, `No ${OPENSPEC}/changes folder in ${located.workspace.name}`],
        spendEnabled: located.config.runs !== null,
        checkedAt: Date.now()
      }
    }
    const pullRequests = await lookUp(located, names, fresh)
    const read = await Promise.all(
      names.map((name) => readCard(io, located.root, name, located.config, pullRequests.get(name) ?? null))
    )
    const changes = await Promise.all(
      read.map(async (card) => ({
        ...card,
        inThisWorkspace: belongsTo(located.workspace, card),
        place: await place(located, card)
      }))
    )
    watchChanges(`${located.root}/changes`)
    current = { located, changes }
    return {
      workspaceId: located.workspace.id,
      changes,
      problems: located.problems,
      spendEnabled: located.config.runs !== null,
      checkedAt: Date.now()
    }
  }

  async function historyRows(located: Located, file: string, folders: string[]): Promise<RunRow[]> {
    const changesPath = `${located.root}/changes`
    const active = (await listChanges(io, located.root)) ?? []
    const archived = ((await io.list(`${changesPath}/${ARCHIVE}`)) ?? [])
      .filter((entry) => entry.directory && !entry.name.startsWith('.'))
      .map((entry) => `${ARCHIVE}/${entry.name}`)
    const paths = [...active, ...archived].map((name) => `${changesPath}/${name}/${file}`)
    for (const folder of folders) {
      const entries = (await io.list(`${located.workspace.path}/${folder}`)) ?? []
      for (const entry of entries) {
        if (!entry.directory && entry.name.endsWith(RUNS_EXTENSION)) {
          paths.push(`${located.workspace.path}/${folder}/${entry.name}`)
        }
      }
    }
    const texts = await Promise.all(paths.map((path) => io.text(path)))
    return texts.flatMap((text) => (text === null ? [] : parseRuns(text)))
  }

  async function listed(ref: ChangeRef): Promise<{ located: Located; card: ChangeCard } | null> {
    if (!current) {
      await board(false)
    }
    const card = current?.changes.find((c) => c.name === ref.change)
    return current && card && current.located.workspace.id === ref.workspaceId ? { located: current.located, card } : null
  }

  async function fileOf(ref: ChangeRef, path: string): Promise<{ located: Located; path: string } | null> {
    const found = await listed(ref)
    if (!found) {
      return null
    }
    const { files } = await listChangeFiles(io, found.located.root, ref.change, found.located.config.exclude)
    return files.includes(path) ? { located: found.located, path: `changes/${ref.change}/${path}` } : null
  }

  orca.panels.handle('board.get', async (input) => board(input?.fresh === true))

  orca.panels.handle('change.files', async (ref) => {
    const found = await listed(ref)
    return found
      ? listChangeFiles(io, found.located.root, ref.change, found.located.config.exclude)
      : { files: [], truncated: false }
  })

  orca.panels.handle('change.read', async (ref) => {
    const file = await fileOf(ref, ref.path)
    return { text: file ? await io.text(`${file.located.root}/${file.path}`) : null }
  })

  orca.panels.handle('change.edit', async (ref) => {
    const file = await fileOf(ref, ref.path)
    if (!file) {
      return { opened: false, message: 'That file is not part of a listed change' }
    }
    await orca.host.call('editor.open', {
      workspaceId: file.located.workspace.id,
      path: `${OPENSPEC}/${file.path}`
    })
    return { opened: true, message: `Opened ${ref.path}` }
  })

  const commandOf = (card: ChangeCard, name: CommandName) => card.commands.find((command) => command.name === name)

  orca.panels.handle('change.run', async ({ workspaceId, change, command, terminalId }) => {
    const found = await listed({ workspaceId, change })
    if (!found || found.card.place.kind !== 'here') {
      return { sent: false, message: 'That change runs in its own workspace, not from here' }
    }
    const chosen = commandOf(found.card, command)
    if (!chosen) {
      return { sent: false, message: `That change has no ${command} at its stage` }
    }
    const { agents } = await orca.host.call('agents.list')
    if (!agents.some((agent) => agent.terminalId === terminalId)) {
      return { sent: false, message: 'That agent terminal is gone' }
    }
    const { accepted } = await orca.host.call('terminal.sendText', { terminalId, text: chosen.text, enter: true })
    return { sent: accepted, message: accepted ? `Sent ${chosen.text}` : 'Orca did not accept the text' }
  })

  orca.panels.handle('change.start', async ({ workspaceId, change, command }) => {
    const found = await listed({ workspaceId, change })
    const target = found?.card.place
    const chosen = found ? commandOf(found.card, command) : undefined
    if (!found || target?.kind !== 'new' || !chosen) {
      return { started: false, message: 'That change cannot start a workspace from here' }
    }
    const { workspaces } = await orca.host.call('workspace.list')
    if (workspaces.some((workspace) => workspace.name === target.workspaceName)) {
      return { started: false, message: `A workspace named ${target.workspaceName} already exists; refresh the board` }
    }
    const reply = cliReply(
      await io.run(ORCA_CLI, [
        'worktree',
        'create',
        '--repo',
        `path:${found.located.workspace.path}`,
        '--name',
        target.workspaceName,
        '--no-parent',
        '--agent',
        found.located.config.agent,
        '--prompt',
        chosen.text,
        '--activate',
        '--json'
      ])
    )
    if (!reply?.ok) {
      return { started: false, message: reply?.error?.message ?? 'Orca did not create the workspace' }
    }
    return { started: true, message: `Created ${target.workspaceName}; ${found.located.config.agent} got ${chosen.text}` }
  })

  orca.panels.handle('change.tasks', async (ref) => {
    const found = await listed(ref)
    const text = found ? await io.text(`${found.located.root}/changes/${ref.change}/tasks.md`) : null
    return { sections: text === null ? null : taskSections(text) }
  })

  orca.panels.handle('change.spend', async (ref) => {
    const found = await listed(ref)
    const runs = found?.located.config.runs
    const text = found && runs ? await io.text(`${found.located.root}/changes/${ref.change}/${runs.file}`) : null
    return { spend: text === null ? null : changeSpendDetail(parseRuns(text)) }
  })

  orca.panels.handle('spend.history', async () => {
    const located = await locate()
    const runs = typeof located === 'string' ? null : located.config.runs
    return {
      history:
        typeof located === 'string' || !runs
          ? null
          : spendHistory(await historyRows(located, runs.file, runs.folders))
    }
  })

  orca.panels.handle('task.run', async ({ workspaceId, change, task, terminalId }) => {
    const found = await listed({ workspaceId, change })
    if (!found || found.card.place.kind !== 'here') {
      return { sent: false, message: 'That change runs in its own workspace, not from here' }
    }
    const text = await io.text(`${found.located.root}/changes/${change}/tasks.md`)
    const open = taskSections(text ?? '').some((section) => section.tasks.some((item) => !item.done && item.text === task))
    if (!open) {
      return { sent: false, message: 'That task is not an open task of this change any more' }
    }
    const built = applyText(found.located.config.task, change, found.card.ticket, task)
    if ('refused' in built) {
      return { sent: false, message: built.refused }
    }
    const { agents } = await orca.host.call('agents.list')
    if (!agents.some((agent) => agent.terminalId === terminalId)) {
      return { sent: false, message: 'That agent terminal is gone' }
    }
    const { accepted } = await orca.host.call('terminal.sendText', { terminalId, text: built.text, enter: true })
    return { sent: accepted, message: accepted ? `Sent ${built.text}` : 'Orca did not accept the text' }
  })

  orca.panels.handle('workspace.go', async ({ workspaceId }) => {
    const target = current?.changes
      .map((card) => card.place)
      .find((place) => place.kind === 'elsewhere' && place.workspaceId === workspaceId)
    if (!target || target.kind !== 'elsewhere') {
      return { opened: false, message: 'That workspace is not the own workspace of a listed change' }
    }
    await orca.host.call('workspace.open', { workspaceId })
    return { opened: true, message: `Opened ${target.workspaceName}` }
  })

  return () => {
    watched?.stop()
    watched = null
  }
}
