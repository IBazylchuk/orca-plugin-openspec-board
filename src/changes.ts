import { applyText } from './apply'
import type { BoardConfig } from './config'
import { changeSpend, parseRuns } from './spend'
import type { ChangeCard, Command, CommandName, Count, PullRequest, Stage, TaskSection, Ticket } from './protocol'

export interface Entry {
  name: string
  directory: boolean
}

export interface Files {
  list(path: string): Promise<Entry[] | null>
  text(path: string): Promise<string | null>
}

export const ARCHIVE = 'archive'
export const MAX_FILES = 200
const MAX_DEPTH = 6
const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]/gm
const SKIP_SPECS = /^skip_specs:\s*true\s*$/m

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/
const TASK = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/

export function taskSections(markdown: string): TaskSection[] {
  const sections: TaskSection[] = [{ title: '', tasks: [] }]
  for (const line of markdown.split('\n')) {
    const heading = HEADING.exec(line)
    const task = TASK.exec(line)
    if (heading) {
      sections.push({ title: heading[1], tasks: [] })
    } else if (task) {
      sections[sections.length - 1].tasks.push({ text: task[2].trim(), done: task[1] !== ' ' })
    }
  }
  return sections.filter((section) => section.tasks.length > 0)
}

export function countTasks(markdown: string): Count {
  let done = 0
  let total = 0
  for (const match of markdown.matchAll(TASK_LINE)) {
    total += 1
    if (match[1] !== ' ') {
      done += 1
    }
  }
  return { done, total }
}

const PARAGRAPH_BREAK = /^\s*($|[-*+]\s|\d+\.\s|#|>|```)/
const MAX_RESUME_LENGTH = 400

export function resumeLine(markdown: string | null, pattern: RegExp | null): string | null {
  if (!markdown || !pattern) {
    return null
  }
  const lines = markdown.split('\n')
  const start = lines.findIndex((candidate) => pattern.test(candidate))
  if (start === -1) {
    return null
  }
  const following = lines.slice(start + 1)
  const end = following.findIndex((line) => PARAGRAPH_BREAK.test(line))
  const paragraph = [lines[start], ...following.slice(0, end === -1 ? following.length : end)]
    .map((line) => line.trim())
    .join(' ')
  const text = paragraph.replace(pattern, '').trim() || paragraph
  return text.length > MAX_RESUME_LENGTH ? `${text.slice(0, MAX_RESUME_LENGTH - 1)}…` : text
}

export function ticketOf(change: string, config: BoardConfig): Ticket | null {
  const rule = config.ticket
  const match = rule ? rule.pattern.exec(change) : null
  if (!rule || !match) {
    return null
  }
  const key = rule.key.replace(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? '')
  const url = rule.url ? rule.url.replaceAll('{ticket}', encodeURIComponent(key)) : null
  return { key, url }
}

export function stageOf(input: {
  missing: string[]
  tasks: Count
  pullRequests: PullRequest[] | null
  pullRequestsUnknown: boolean
}): Stage {
  if (input.missing.length > 0) {
    return 'planning'
  }
  const prs = input.pullRequests ?? []
  if (prs.some((pr) => pr.state === 'open')) {
    return 'in-review'
  }
  const allTicked = input.tasks.total > 0 && input.tasks.done === input.tasks.total
  if (allTicked && !input.pullRequestsUnknown) {
    return 'complete'
  }
  if (prs.some((pr) => pr.state === 'merged')) {
    return 'merged'
  }
  return input.tasks.done > 0 ? 'in-progress' : 'ready'
}

export const FINISH_FROM_PERCENT = 80

const percentDone = (tasks: Count): number => (tasks.total > 0 ? (tasks.done / tasks.total) * 100 : 0)

export function commandNamesOf(stage: Stage, tasks: Count): CommandName[] {
  switch (stage) {
    case 'planning':
      return []
    case 'ready':
    case 'in-progress':
      return ['apply']
    case 'in-review':
      return percentDone(tasks) >= FINISH_FROM_PERCENT ? ['apply', 'finish'] : ['apply']
    case 'merged':
    case 'complete':
      return ['finish']
  }
}

export function commandsOf(
  stage: Stage,
  tasks: Count,
  config: Pick<BoardConfig, 'apply' | 'finish'>,
  name: string,
  ticket: Ticket | null
): { commands: Command[]; refused: string | null } {
  const commands: Command[] = []
  let refused: string | null = null
  for (const command of commandNamesOf(stage, tasks)) {
    const built = applyText(config[command], name, ticket)
    if ('refused' in built) {
      refused = built.refused
    } else if (!commands.some((known) => known.text === built.text)) {
      commands.push({ name: command, text: built.text })
    }
  }
  return { commands, refused: commands.length > 0 ? null : refused }
}

const changesDir = (root: string): string => `${root}/changes`

export async function listChanges(files: Files, root: string): Promise<string[] | null> {
  const entries = await files.list(changesDir(root))
  if (!entries) {
    return null
  }
  return entries
    .filter((entry) => entry.directory && entry.name !== ARCHIVE && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

export async function readCard(
  files: Files,
  root: string,
  name: string,
  config: BoardConfig,
  pullRequests: PullRequest[] | null
): Promise<ChangeCard> {
  const dir = `${changesDir(root)}/${name}`
  const [entries, tasksText, meta, runsText] = await Promise.all([
    files.list(dir),
    files.text(`${dir}/tasks.md`),
    files.text(`${dir}/.openspec.yaml`),
    config.runs ? files.text(`${dir}/${config.runs.file}`) : null
  ])
  const present = new Map((entries ?? []).map((entry) => [entry.name, entry]))
  const skipSpecs = SKIP_SPECS.test(meta ?? '')
  const required = config.requiredArtifacts.filter((artifact) => !(skipSpecs && artifact === 'specs'))
  const missing: string[] = []
  for (const artifact of required) {
    const entry = present.get(artifact)
    const nonEmptyFolder = entry?.directory ? ((await files.list(`${dir}/${artifact}`)) ?? []).length > 0 : true
    if (!entry || !nonEmptyFolder) {
      missing.push(artifact)
    }
  }
  const tasks = tasksText ? countTasks(tasksText) : { done: 0, total: 0 }
  const ticket = ticketOf(name, config)
  const pullRequestsUnknown = config.pullRequests !== null && ticket !== null && pullRequests === null
  const stage = stageOf({ missing, tasks, pullRequests, pullRequestsUnknown })
  const { commands, refused } = commandsOf(stage, tasks, config, name, ticket)
  return {
    name,
    stage,
    missing,
    tasks,
    resume: resumeLine(tasksText, config.resumeLine),
    ticket,
    pullRequests,
    pullRequestsUnknown,
    spend: runsText === null ? null : changeSpend(parseRuns(runsText)),
    inThisWorkspace: false,
    commands,
    place: commands.length > 0 ? { kind: 'here' } : { kind: 'none', reason: refused }
  }
}

const FIRST_FILES = ['proposal.md', 'design.md', 'tasks.md']

const fileOrder = (a: string, b: string): number => {
  const rank = (path: string): number => {
    const index = FIRST_FILES.indexOf(path)
    return index === -1 ? FIRST_FILES.length : index
  }
  return rank(a) - rank(b) || a.localeCompare(b)
}

export async function listChangeFiles(
  files: Files,
  root: string,
  change: string,
  exclude: string[]
): Promise<{ files: string[]; truncated: boolean }> {
  const base = `${changesDir(root)}/${change}`
  const found: string[] = []
  let truncated = false
  const walk = async (relative: string, depth: number): Promise<void> => {
    const entries = await files.list(relative ? `${base}/${relative}` : base)
    for (const entry of (entries ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FILES) {
        truncated = true
        return
      }
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.name.startsWith('.')) {
        continue
      }
      if (entry.directory) {
        if (depth < MAX_DEPTH && !exclude.includes(entry.name)) {
          await walk(path, depth + 1)
        }
      } else if (entry.name.endsWith('.md')) {
        found.push(path)
      }
    }
  }
  await walk('', 0)
  return { files: found.sort(fileOrder), truncated }
}
