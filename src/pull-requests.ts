import type { PullRequestRule } from './config'
import type { PullRequest } from './protocol'

export type Runner = (command: string, args: string[]) => Promise<string | null>

export const CACHE_MS = 300_000
export const TICKETS_PER_SEARCH = 6
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

export function mentionsTicket(title: string, ticket: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escape(ticket)}(?![0-9A-Za-z])`, 'i').test(title)
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
    .filter((pr) => mentionsTicket(pr.title, ticket))
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
  const keyOf = (rule: PullRequestRule, ticket: string): string => `${rule.owner}\n${ticket}`

  async function search(rule: PullRequestRule, tickets: string[]): Promise<PullRequest[] | null> {
    const query = rule.search.replaceAll('{ticket}', tickets.join(' OR '))
    const output = await run('gh', [
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
    ])
    return output === null ? null : parseSearch(output)
  }

  return async (rule: PullRequestRule, tickets: string[], fresh = false): Promise<Map<string, PullRequest[] | null>> => {
    const unique = [...new Set(tickets)]
    const stale = unique.filter((ticket) => {
      const cached = cache.get(keyOf(rule, ticket))
      return fresh || !cached || now() - cached.at >= CACHE_MS
    })
    for (const group of chunks(stale, TICKETS_PER_SEARCH)) {
      const found = await search(rule, group)
      if (found !== null) {
        for (const ticket of group) {
          cache.set(keyOf(rule, ticket), { at: now(), value: pullRequestsOf(found, ticket) })
        }
      }
    }
    return new Map(unique.map((ticket) => [ticket, cache.get(keyOf(rule, ticket))?.value ?? null]))
  }
}
