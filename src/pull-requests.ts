import type { PullRequestRule } from './config'
import type { PullRequest } from './protocol'

export type Runner = (command: string, args: string[], timeoutMs?: number) => Promise<string | null>

export const CACHE_MS = 300_000
export const TICKETS_PER_SEARCH = 6
export const PARALLEL_SEARCHES = 3
export const GH_TIMEOUT_MS = 10_000
export const FAILURE_MS = 60_000
const RESULTS_PER_SEARCH = '100'
const STATES = new Set(['open', 'closed', 'merged'])

interface Found {
  number?: unknown
  state?: unknown
  isDraft?: unknown
  title?: unknown
  url?: unknown
  repository?: { nameWithOwner?: unknown }
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function mentionsKey(text: string, key: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escape(key)}(?![0-9A-Za-z])`, 'i').test(text)
}

export function parseSearch(json: string): PullRequest[] | null {
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) {
    return null
  }
  return (rows as Found[]).flatMap((row): PullRequest[] => {
    const { number, state, title, url } = row
    const repository = row.repository?.nameWithOwner
    if (
      typeof number !== 'number' ||
      typeof state !== 'string' ||
      !STATES.has(state) ||
      typeof title !== 'string' ||
      typeof url !== 'string' ||
      !url.startsWith('https://') ||
      typeof repository !== 'string'
    ) {
      return []
    }
    return [{ repository, number, state: state as PullRequest['state'], draft: row.isDraft === true, title, url }]
  })
}

export function pullRequestsOf(found: PullRequest[], ticket: string): PullRequest[] {
  return found
    .filter((pr) => mentionsKey(pr.title, ticket))
    .sort((a, b) => a.repository.localeCompare(b.repository) || a.number - b.number)
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size))
  }
  return result
}

export function pullRequestFinder(run: Runner, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; value: PullRequest[] }>()
  const failedAt = new Map<string, number>()
  const keyOf = (rule: PullRequestRule, ticket: string): string => `${rule.owner}\n${ticket}`

  async function search(rule: PullRequestRule, tickets: string[]): Promise<PullRequest[] | null> {
    const query = rule.search.replaceAll('{ticket}', tickets.join(' OR '))
    const output = await run(
      'gh',
      [
        'search',
        'prs',
        '--owner',
        rule.owner,
        '--json',
        'repository,number,state,isDraft,title,url',
        '--limit',
        RESULTS_PER_SEARCH,
        '--',
        query
      ],
      GH_TIMEOUT_MS
    )
    return output === null ? null : parseSearch(output)
  }

  const lookedUp = (rule: PullRequestRule, unique: string[]): Map<string, PullRequest[] | null> =>
    new Map(unique.map((ticket) => [ticket, cache.get(keyOf(rule, ticket))?.value ?? null]))

  async function searchGroup(rule: PullRequestRule, group: string[]): Promise<void> {
    const found = await search(rule, group)
    for (const ticket of group) {
      if (found === null) {
        failedAt.set(keyOf(rule, ticket), now())
      } else {
        failedAt.delete(keyOf(rule, ticket))
        cache.set(keyOf(rule, ticket), { at: now(), value: pullRequestsOf(found, ticket) })
      }
    }
  }

  const needsSearch = (rule: PullRequestRule, ticket: string, fresh: boolean): boolean => {
    const key = keyOf(rule, ticket)
    const cached = cache.get(key)
    const failed = failedAt.get(key)
    if (fresh) {
      return true
    }
    if (failed !== undefined && now() - failed < FAILURE_MS) {
      return false
    }
    return !cached || now() - cached.at >= CACHE_MS
  }

  const find = async (rule: PullRequestRule, tickets: string[], fresh = false): Promise<Map<string, PullRequest[] | null>> => {
    const unique = [...new Set(tickets)]
    const queue = chunks(
      unique.filter((ticket) => needsSearch(rule, ticket, fresh)),
      TICKETS_PER_SEARCH
    )
    const lane = async (): Promise<void> => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        await searchGroup(rule, group)
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_SEARCHES, queue.length) }, lane))
    return lookedUp(rule, unique)
  }

  const remembered = (rule: PullRequestRule, tickets: string[]): Map<string, PullRequest[] | null> =>
    lookedUp(rule, [...new Set(tickets)])

  return Object.assign(find, { remembered })
}
