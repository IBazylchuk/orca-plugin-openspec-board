import { execFile } from 'node:child_process'
import { watch } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import type { Io } from './handlers'

const PATH = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin`
const RUN_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const SETTLE_MS = 700

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
    }),
  watch: (path, onChange) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const settled = () => {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(onChange, SETTLE_MS)
      timer.unref()
    }
    try {
      const watcher = watch(path, { recursive: true }, settled)
      watcher.on('error', () => watcher.close())
      watcher.unref()
      return () => {
        watcher.close()
        if (timer) {
          clearTimeout(timer)
        }
      }
    } catch {
      return () => undefined
    }
  }
}
