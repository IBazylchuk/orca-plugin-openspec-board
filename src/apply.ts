import type { Ticket } from './protocol'

const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029)
const CONTROL = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${LINE_SEPARATORS}]`)

export function applyText(
  template: string,
  change: string,
  ticket: Ticket | null,
  task: string | null = null
): { text: string } | { refused: string } {
  if (template.includes('{ticket}') && !ticket) {
    return { refused: `The command needs a ticket, and "${change}" does not match the ticket pattern` }
  }
  const values: Record<string, string> = { change, ticket: ticket?.key ?? '', task: task ?? '' }
  for (const [name, value] of Object.entries(values)) {
    if (CONTROL.test(value)) {
      return { refused: `The ${name} name holds a control character, so nothing was typed` }
    }
  }
  const text = template.replace(/\{(change|ticket|task)\}/g, (_, name: string) => values[name])
  if (CONTROL.test(text)) {
    return { refused: 'The command holds a control character, so nothing was typed' }
  }
  return { text }
}
