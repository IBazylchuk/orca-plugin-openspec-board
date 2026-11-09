import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import type { Io } from './handlers'

const PATH = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin`
const RUN_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export const diskIo: Io = {
  list: async (path) => {
    try {
      const entries = await readdir(path, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
    } catch {
      return null
    }
  },
  text: async (path) => {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  },
  run: (command, args) =>
    new Promise((resolve) => {
      execFile(
        command,
        args,
        { env: { ...process.env, PATH }, timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout) => resolve(error ? null : stdout)
      )
    })
}
