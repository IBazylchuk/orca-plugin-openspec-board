import type { OrcaWorkerApi } from 'orca/worker'
import { diskIo } from './disk-io'
import { register } from './handlers'

let stop: (() => void) | null = null

export default function activate(orca: OrcaWorkerApi): void {
  stop = register(orca, diskIo)
}

export function deactivate(): void {
  stop?.()
  stop = null
}
