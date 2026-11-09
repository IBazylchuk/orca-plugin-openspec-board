import type { OrcaWorkerApi } from 'orca/worker'
import { applyText } from './apply'
import { placeApply, type PlacedWorkspace } from './apply-target'
import { CONFIG_FILE, parseConfig, type BoardConfig } from './config'
import { listChangeFiles, listChanges, readCard, ticketOf, type Files } from './changes'
import { pullRequestFinder, type Runner } from './pull-requests'
import type { BoardSnapshot, ChangeCard, ChangeRef, PullRequest } from './protocol'

export interface Io extends Files {
  run: Runner
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

const isLocal = (workspace: Workspace): boolean => workspace.hostId === null || workspace.hostId === 'local'

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

export function register(orca: OrcaWorkerApi, io: Io): void {
  const findPullRequests = pullRequestFinder(io.run)
  let current: { located: Located; changes: ChangeCard[] } | null = null

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

  async function board(fresh: boolean): Promise<BoardSnapshot> {
    const located = await locate()
    if (typeof located === 'string') {
      current = null
      return { workspaceId: null, changes: [], problems: [located], checkedAt: Date.now() }
    }
    const names = await listChanges(io, located.root)
    if (names === null) {
      current = null
      return {
        workspaceId: located.workspace.id,
        changes: [],
        problems: [...located.problems, `No ${OPENSPEC}/changes folder in ${located.workspace.name}`],
        checkedAt: Date.now()
      }
    }
    const pullRequests = await lookUp(located, names, fresh)
    const read = await Promise.all(
      names.map((name) => readCard(io, located.root, name, located.config, pullRequests.get(name) ?? null))
    )
    const changes = read.map((card) => ({
      ...card,
      apply: placeApply(card, located.workspace, located.others, located.config.applyAnywhere)
    }))
    current = { located, changes }
    return { workspaceId: located.workspace.id, changes, problems: located.problems, checkedAt: Date.now() }
  }

  function listed(ref: ChangeRef): { located: Located; card: ChangeCard } | null {
    const card = current?.changes.find((c) => c.name === ref.change)
    return current && card && current.located.workspace.id === ref.workspaceId ? { located: current.located, card } : null
  }

  async function fileOf(ref: ChangeRef, path: string): Promise<{ located: Located; path: string } | null> {
    const found = listed(ref)
    if (!found) {
      return null
    }
    const { files } = await listChangeFiles(io, found.located.root, ref.change, found.located.config.exclude)
    return files.includes(path) ? { located: found.located, path: `changes/${ref.change}/${path}` } : null
  }

  orca.panels.handle('board.get', async (input) => board(input?.fresh === true))

  orca.panels.handle('change.files', async (ref) => {
    const found = listed(ref)
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

  orca.panels.handle('change.apply', async ({ workspaceId, change, terminalId }) => {
    const found = listed({ workspaceId, change })
    if (!found || found.card.apply.kind !== 'here') {
      return { sent: false, message: 'That change is applied in its own workspace, not from here' }
    }
    const { agents } = await orca.host.call('agents.list')
    if (!agents.some((agent) => agent.terminalId === terminalId)) {
      return { sent: false, message: 'That agent terminal is gone' }
    }
    const built = applyText(found.located.config.apply, change, found.card.ticket)
    if ('refused' in built) {
      return { sent: false, message: built.refused }
    }
    const { accepted } = await orca.host.call('terminal.sendText', { terminalId, text: built.text, enter: true })
    return { sent: accepted, message: accepted ? `Sent ${built.text}` : 'Orca did not accept the text' }
  })

  orca.panels.handle('workspace.go', async ({ workspaceId }) => {
    const target = current?.changes
      .map((card) => card.apply)
      .find((apply) => apply.kind === 'elsewhere' && apply.workspaceId === workspaceId)
    if (!target || target.kind !== 'elsewhere') {
      return { opened: false, message: 'That workspace is not the own workspace of a listed change' }
    }
    await orca.host.call('workspace.open', { workspaceId })
    return { opened: true, message: `Opened ${target.workspaceName}` }
  })
}
