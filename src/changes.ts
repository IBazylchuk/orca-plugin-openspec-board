import { applyText } from './apply'
import type { BoardConfig } from './config'
import type { ChangeCard, Count, PullRequest, Stage, Ticket } from './protocol'

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

export function resumeLine(markdown: string | null, pattern: RegExp | null): string | null {
  if (!markdown || !pattern) {
    return null
  }
  const line = markdown.split('\n').find((candidate) => pattern.test(candidate))
  return line ? line.replace(pattern, '').trim() || line.trim() : null
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
  complete: BoardConfig['complete']
}): Stage {
  if (input.missing.length > 0) {
    return 'planning'
  }
  const prs = input.pullRequests ?? []
  if (input.complete === 'pullRequests') {
    if (prs.length > 0 && prs.every((pr) => pr.state !== 'open')) {
      return prs.some((pr) => pr.state === 'merged') ? 'complete' : 'in-progress'
    }
    if (prs.some((pr) => pr.state === 'open')) {
      return 'in-review'
    }
  } else {
    if (input.tasks.total > 0 && input.tasks.done === input.tasks.total) {
      return 'complete'
    }
    if (prs.some((pr) => pr.state === 'open')) {
      return 'in-review'
    }
  }
  return input.tasks.done > 0 ? 'in-progress' : 'ready'
}

export const isApplicable = (stage: Stage): boolean => stage !== 'planning' && stage !== 'complete'

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
  const [entries, tasksText, meta] = await Promise.all([
    files.list(dir),
    files.text(`${dir}/tasks.md`),
    files.text(`${dir}/.openspec.yaml`)
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
  const stage = stageOf({ missing, tasks, pullRequests, complete: config.complete })
  const ticket = ticketOf(name, config)
  return {
    name,
    stage,
    missing,
    tasks,
    resume: resumeLine(tasksText, config.resumeLine),
    ticket,
    pullRequests,
    applicable: isApplicable(stage) && 'text' in applyText(config.apply, name, ticket)
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
