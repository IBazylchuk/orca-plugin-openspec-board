export interface TicketRule {
  pattern: RegExp
  key: string
  url: string | null
}

export interface PullRequestRule {
  owner: string
  search: string
}

export interface BoardConfig {
  requiredArtifacts: string[]
  resumeLine: RegExp | null
  ticket: TicketRule | null
  pullRequests: PullRequestRule | null
  apply: string
  finish: string
  agent: string
  applyAnywhere: boolean
  exclude: string[]
}

export const CONFIG_FILE = 'board.json'

export const DEFAULT_CONFIG: BoardConfig = {
  requiredArtifacts: ['proposal.md', 'design.md', 'tasks.md', 'specs'],
  resumeLine: null,
  ticket: null,
  pullRequests: null,
  apply: '/opsx:apply {change}',
  finish: '/opsx:archive {change}',
  agent: 'claude',
  applyAnywhere: false,
  exclude: []
}

const SAFE_PATH_PART = /^[^/\\\0]+$/
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const AGENT = /^[a-z][a-z0-9-]{0,31}$/

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

function compile(source: unknown, field: string, problems: string[]): RegExp | null {
  if (typeof source !== 'string' || source === '') {
    problems.push(`${field} must be a non-empty regular expression`)
    return null
  }
  try {
    return new RegExp(source, 'm')
  } catch {
    problems.push(`${field} is not a valid regular expression`)
    return null
  }
}

const isWebUrlTemplate = (value: string): boolean => /^https?:\/\/[^\s]+$/.test(value)

function parseTicket(raw: unknown, problems: string[]): TicketRule | null {
  if (!isObject(raw)) {
    problems.push('ticket must be an object with pattern and key')
    return null
  }
  const pattern = compile(raw.pattern, 'ticket.pattern', problems)
  if (typeof raw.key !== 'string' || raw.key === '') {
    problems.push('ticket.key must be a non-empty string such as "PROJ-$1"')
    return null
  }
  if (raw.url !== undefined && (typeof raw.url !== 'string' || !isWebUrlTemplate(raw.url))) {
    problems.push('ticket.url must be an http(s) address containing {ticket}')
    return null
  }
  return pattern ? { pattern, key: raw.key, url: typeof raw.url === 'string' ? raw.url : null } : null
}

function parsePullRequests(raw: unknown, problems: string[]): PullRequestRule | null {
  if (!isObject(raw) || typeof raw.owner !== 'string' || !OWNER.test(raw.owner)) {
    problems.push('pullRequests.owner must be a GitHub user or organisation name')
    return null
  }
  const search = raw.search === undefined ? '{ticket}' : raw.search
  if (typeof search !== 'string' || !search.includes('{ticket}')) {
    problems.push('pullRequests.search must contain {ticket}')
    return null
  }
  return { owner: raw.owner, search }
}

export function parseConfig(text: string | null): { config: BoardConfig; problems: string[] } {
  if (text === null) {
    return { config: DEFAULT_CONFIG, problems: [] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { config: DEFAULT_CONFIG, problems: [`${CONFIG_FILE} is not valid JSON; using the defaults`] }
  }
  if (!isObject(raw)) {
    return { config: DEFAULT_CONFIG, problems: [`${CONFIG_FILE} must hold a JSON object; using the defaults`] }
  }
  const problems: string[] = []
  const config: BoardConfig = { ...DEFAULT_CONFIG }

  if (raw.requiredArtifacts !== undefined) {
    if (isStringList(raw.requiredArtifacts) && raw.requiredArtifacts.every((name) => SAFE_PATH_PART.test(name))) {
      config.requiredArtifacts = raw.requiredArtifacts
    } else {
      problems.push('requiredArtifacts must be a list of file or folder names inside a change')
    }
  }
  if (raw.complete !== undefined) {
    problems.push('complete is no longer read: a change is Complete once every task is ticked and no pull request is open')
  }
  if (raw.resumeLine !== undefined) {
    config.resumeLine = compile(raw.resumeLine, 'resumeLine', problems)
  }
  if (raw.ticket !== undefined) {
    config.ticket = parseTicket(raw.ticket, problems)
  }
  if (raw.pullRequests !== undefined) {
    config.pullRequests = parsePullRequests(raw.pullRequests, problems)
  }
  if (raw.apply !== undefined) {
    if (typeof raw.apply === 'string' && raw.apply.trim() !== '') {
      config.apply = raw.apply
    } else {
      problems.push('apply must be a non-empty command such as "/opsx:apply {change}"')
    }
  }
  if (raw.finish !== undefined) {
    if (typeof raw.finish === 'string' && raw.finish.trim() !== '') {
      config.finish = raw.finish
    } else {
      problems.push('finish must be a non-empty command such as "/opsx:archive {change}"')
    }
  }
  if (raw.agent !== undefined) {
    if (typeof raw.agent === 'string' && AGENT.test(raw.agent)) {
      config.agent = raw.agent
    } else {
      problems.push('agent must be the name of an agent Orca starts, such as "claude" or "codex"')
    }
  }
  if (raw.applyAnywhere !== undefined) {
    if (typeof raw.applyAnywhere === 'boolean') {
      config.applyAnywhere = raw.applyAnywhere
    } else {
      problems.push('applyAnywhere must be true or false')
    }
  }
  if (raw.files !== undefined) {
    const exclude = isObject(raw.files) ? raw.files.exclude : undefined
    if (isStringList(exclude) && exclude.every((name) => SAFE_PATH_PART.test(name))) {
      config.exclude = exclude
    } else {
      problems.push('files.exclude must be a list of folder names')
    }
  }
  return { config, problems }
}
