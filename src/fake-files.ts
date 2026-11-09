import type { Entry, Files } from './changes'

export function fakeFiles(tree: Record<string, string>): Files & { listed: string[] } {
  const listed: string[] = []
  const paths = Object.keys(tree)
  return {
    listed,
    list: async (path) => {
      listed.push(path)
      const prefix = `${path}/`
      const children = new Map<string, Entry>()
      for (const file of paths) {
        if (file.startsWith(prefix)) {
          const [name, ...rest] = file.slice(prefix.length).split('/')
          const directory = rest.length > 0
          if (!children.has(name) || directory) {
            children.set(name, { name, directory })
          }
        }
      }
      return children.size > 0 ? [...children.values()] : null
    },
    text: async (path) => tree[path] ?? null
  }
}
