import { RUN_CLIENT, type ChangeSpend, type ChangeSpendDetail, type RunClient, type Spend, type SpendHistory } from './protocol'

export const MAX_RUN_LINES = 20_000
export const UNKNOWN_KEY = 'unknown'
export const NO_TASK_KEY = 'no task'
export const TOTAL_KEY = 'total'

const MONTH = /^\d{4}-\d{2}$/
const COST_DECIMALS = 10_000
const BILLING = { SUBSCRIPTION: 'subscription', ESTIMATE: 'estimate' } as const
const RUN_CLIENTS = Object.values(RUN_CLIENT)

export interface RunRow {
  at: string | null
  model: string | null
  agentType: string | null
  task: string | null
  client: RunClient
  billing: typeof BILLING[keyof typeof BILLING] | null
  costUsd: number | null
  inputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens: number
  durationMs: number
  checkFailures: number
  isEscalated: boolean
}

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

const numberOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const textOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

const TOKEN_FIELDS = ['inputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'outputTokens', 'reasoningTokens'] as const

function rowOf(raw: Raw): RunRow | null {
  const costUsd = numberOf(raw.costUsd)
  const client = RUN_CLIENTS.find((known) => known === raw.client)
  const billing = raw.billing === BILLING.SUBSCRIPTION || raw.billing === BILLING.ESTIMATE ? raw.billing : null
  const legacyEstimate = raw.client === undefined && raw.billing === undefined && costUsd !== null
  const tokens = TOKEN_FIELDS.map((field) => numberOf(raw[field]))
  if (costUsd === null && !billing && !client && tokens.every((count) => count === null)) {
    return null
  }
  const [inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, reasoningTokens] = tokens.map((count) => count ?? 0)
  return {
    at: textOf(raw.at),
    model: textOf(raw.model),
    agentType: textOf(raw.agentType),
    task: textOf(raw.task),
    client: client ?? (raw.client === undefined ? RUN_CLIENT.CLAUDE : RUN_CLIENT.UNKNOWN),
    billing: legacyEstimate ? BILLING.ESTIMATE : billing,
    costUsd,
    inputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    outputTokens,
    reasoningTokens,
    durationMs: numberOf(raw.durationMs) ?? 0,
    checkFailures: numberOf(raw.checkFailures) ?? 0,
    isEscalated: raw.isEscalated === true
  }
}

export function parseRuns(text: string): RunRow[] {
  const lines = text.split('\n')
  const rows: RunRow[] = []
  for (const line of lines.length > MAX_RUN_LINES ? lines.slice(-MAX_RUN_LINES) : lines) {
    if (line.trim() === '') {
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    const row = isObject(raw) ? rowOf(raw) : null
    if (row) {
      rows.push(row)
    }
  }
  return rows
}

const emptySpend = (key: string): Spend => ({
  key,
  runs: 0,
  costUsd: null,
  subscriptionRuns: 0,
  unknownBillingRuns: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  durationMs: 0,
  checkFailures: 0,
  escalated: 0
})

function accumulate(spend: Spend, row: RunRow): void {
  spend.runs += 1
  if (row.billing === BILLING.SUBSCRIPTION) {
    spend.subscriptionRuns += 1
  } else if (row.billing === BILLING.ESTIMATE && row.costUsd !== null) {
    spend.costUsd = (spend.costUsd ?? 0) + row.costUsd
  } else {
    spend.unknownBillingRuns += 1
  }
  spend.inputTokens += row.inputTokens
  spend.cacheWriteTokens += row.cacheWriteTokens
  spend.cacheReadTokens += row.cacheReadTokens
  spend.outputTokens += row.outputTokens
  spend.reasoningTokens += row.reasoningTokens
  spend.durationMs += row.durationMs
  spend.checkFailures += row.checkFailures
  spend.escalated += row.isEscalated ? 1 : 0
}

function rounded(spend: Spend): Spend {
  if (spend.costUsd !== null) {
    const roundedCost = Math.round(spend.costUsd * COST_DECIMALS) / COST_DECIMALS
    spend.costUsd = roundedCost || spend.costUsd
  }
  return spend
}

export function totalOf(rows: RunRow[]): Spend {
  const total = emptySpend(TOTAL_KEY)
  for (const row of rows) {
    accumulate(total, row)
  }
  return rounded(total)
}

function groupBy(rows: RunRow[], keyOf: (row: RunRow) => string): Spend[] {
  const groups = new Map<string, Spend>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key) ?? emptySpend(key)
    accumulate(group, row)
    groups.set(key, group)
  }
  return [...groups.values()].map(rounded)
}

const byCostDescending = (a: Spend, b: Spend): number =>
  (b.costUsd ?? -Infinity) - (a.costUsd ?? -Infinity) || a.key.localeCompare(b.key)

const clientOf = (row: RunRow): RunClient => row.client

const modelOf = (row: RunRow): string => row.model ?? UNKNOWN_KEY

const agentOf = (row: RunRow): string => row.agentType ?? UNKNOWN_KEY

const taskOf = (row: RunRow): string => row.task ?? NO_TASK_KEY

export const monthOf = (row: RunRow): string => (row.at !== null && MONTH.test(row.at.slice(0, 7)) ? row.at.slice(0, 7) : UNKNOWN_KEY)

const NUMBER = /^\d+$/

export function taskOrder(a: string, b: string): number {
  if (a === NO_TASK_KEY || b === NO_TASK_KEY) {
    return Number(a === NO_TASK_KEY) - Number(b === NO_TASK_KEY)
  }
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const numeric = NUMBER.test(left[index]) && NUMBER.test(right[index])
    const difference = numeric ? Number(left[index]) - Number(right[index]) : left[index].localeCompare(right[index])
    if (difference !== 0) {
      return difference
    }
  }
  return left.length - right.length
}

export function changeSpend(rows: RunRow[]): ChangeSpend | null {
  return rows.length === 0 ? null : { total: totalOf(rows), byModel: groupBy(rows, modelOf).sort(byCostDescending) }
}

export function changeSpendDetail(rows: RunRow[]): ChangeSpendDetail | null {
  const summary = changeSpend(rows)
  return summary
    ? {
        ...summary,
        byClient: groupBy(rows, clientOf).sort(byCostDescending),
        byTask: groupBy(rows, taskOf).sort((a, b) => taskOrder(a.key, b.key)),
        byAgent: groupBy(rows, agentOf).sort(byCostDescending)
      }
    : null
}

export function spendHistory(rows: RunRow[]): SpendHistory {
  const inMonth = new Map<string, RunRow[]>()
  for (const row of rows) {
    const month = monthOf(row)
    const monthRows = inMonth.get(month) ?? []
    monthRows.push(row)
    inMonth.set(month, monthRows)
  }
  const months = [...inMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, monthRows]) => ({
      month,
      total: totalOf(monthRows),
      byModel: groupBy(monthRows, modelOf).sort(byCostDescending)
    }))
  return {
    months,
    total: totalOf(rows),
    byClient: groupBy(rows, clientOf).sort(byCostDescending),
    byModel: groupBy(rows, modelOf).sort(byCostDescending)
  }
}
