import type { OrcaWorkerApi } from 'orca/worker'
import { diskIo } from './disk-io'
import { register } from './handlers'

export default function activate(orca: OrcaWorkerApi): void {
  register(orca, diskIo)
}
