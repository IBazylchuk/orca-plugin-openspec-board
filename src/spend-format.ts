import type { ChangeSpend } from './protocol'

export const MODELS_ON_CARD = 3
const MODEL_PREFIX = /^claude-/
const MILLISECONDS_PER_MINUTE = 60_000
const TOKENS_PER_THOUSAND = 1_000
const TOKENS_PER_MILLION = 1_000_000
const SMALLEST_SHOWN_COST = 0.005

const trimmed = (value: number, suffix: string): string => `${value.toFixed(1).replace(/\.0$/, '')}${suffix}`

export function formatMoney(costUsd: number): string {
  if (costUsd > 0 && costUsd < SMALLEST_SHOWN_COST) {
    return '<$0.01'
  }
  return `$${costUsd.toFixed(2)}`
}

export function formatTokens(count: number): string {
  if (count < TOKENS_PER_THOUSAND) {
    return String(count)
  }
  const thousands = count / TOKENS_PER_THOUSAND
  return Math.round(thousands * 10) / 10 < TOKENS_PER_THOUSAND
    ? trimmed(thousands, 'k')
    : trimmed(count / TOKENS_PER_MILLION, 'M')
}

export const formatMinutes = (durationMs: number): string => trimmed(durationMs / MILLISECONDS_PER_MINUTE, '')

export const modelLabel = (model: string): string => model.replace(MODEL_PREFIX, '')

export function spendLine(spend: ChangeSpend): string {
  const models = spend.byModel.slice(0, MODELS_ON_CARD).map((model) => `${modelLabel(model.key)} ${formatMoney(model.costUsd)}`)
  const hidden = spend.byModel.length - MODELS_ON_CARD
  const parts = [formatMoney(spend.total.costUsd), ...models, ...(hidden > 0 ? [`+${hidden} more`] : [])]
  return `Agent runs: ${parts.join(' · ')}`
}
