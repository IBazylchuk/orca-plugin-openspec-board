import { defineCheck } from 'orca/testing'

export default defineCheck({
  noFocusedWorkspace: {},
  emptyProject: {
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'app', terminals: [] },
      'workspace.list': { workspaces: [], truncated: false }
    }
  }
})
