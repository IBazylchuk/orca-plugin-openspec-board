# OpenSpec Board for Orca

A read-only board of the [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes in
the workspace Orca shows. Each change appears under its stage with its task progress,
the line you resume from, its ticket and its pull requests. Buttons at the top count the
changes in each stage and show one stage at a time. Apply and Finish send a command you
choose to an agent of the change's own workspace, and can start that workspace.

Without a config it behaves like plain OpenSpec. Teams that run OpenSpec their own way
describe that in one file, `openspec/board.json`, and the board follows it.

## Install

In Orca, install the plugin from this repository's Git URL, then approve the access it
asks for: read the focused workspace, read the agent list, send text to a terminal, and
open workspaces and files in Orca (for "Open in editor" and "Go to"). Without a version
Orca installs the newest `vX.Y.Z` tag.

The worker runs as a trusted Orca worker, with your account's access to the machine.
It only reads files under `openspec/changes`, runs `gh search prs` when you configure
pull requests, runs `orca worktree create` when you press a "… in new" button, and never
writes a file.

## Stages

| Stage | When |
|---|---|
| Planning | A required artifact is missing |
| Ready | Every artifact is there, no task ticked |
| In progress | Some tasks ticked |
| In review | A pull request of the change is open |
| Merged, tasks open | Every pull request is closed and one is merged, but some tasks are not ticked: either work is left or `tasks.md` is behind |
| Complete | Every task ticked and no pull request open |

A merged pull request alone never makes a change Complete: the tasks say what the change
promised, and a change whose pull requests are in but whose tasks are open is the one
that silently stalls.

Archived changes are not shown.

## Config

`openspec/board.json`, every key optional:

```json
{
  "requiredArtifacts": ["proposal.md", "design.md", "tasks.md"],
  "resumeLine": "^Next:",
  "ticket": {
    "pattern": "^proj-(\\d+)",
    "key": "PROJ-$1",
    "url": "https://tracker.example.com/browse/{ticket}"
  },
  "pullRequests": { "owner": "example-org", "search": "{ticket} in:title" },
  "apply": "/work {ticket}",
  "finish": "/close {ticket}",
  "agent": "claude",
  "files": { "exclude": ["research"] }
}
```

| Key | Default | Meaning |
|---|---|---|
| `requiredArtifacts` | `proposal.md`, `design.md`, `tasks.md`, `specs` | Files or folders a change needs to leave Planning. `skip_specs: true` in a change's `.openspec.yaml` drops `specs` for that change |
| `resumeLine` | none | A regular expression for the line in `tasks.md` that says what comes next; the card shows the rest of its paragraph |
| `ticket` | none | `pattern` matched against the change folder name, `key` built from its groups, optional `url` with `{ticket}` |
| `pullRequests` | off | `gh search prs --owner <owner>` with `search`, where `{ticket}` becomes up to six tickets joined by `OR`. Only pull requests whose title names the ticket count. Results are kept five minutes, and kept as they were when a search fails. GitHub allows 30 searches a minute per account, shared with your other `gh` use. Needs `gh` signed in |
| `apply` | `/opsx:apply {change}` | What Apply sends; `{change}` and `{ticket}` are replaced |
| `finish` | `/opsx:archive {change}` | What Finish sends: check the change is done and archive it, or say what is left |
| `agent` | `claude` | The agent a "… in new" button starts in the new workspace |
| `applyAnywhere` | `false` | `true` lets Apply send any change to an agent of whatever workspace is focused, instead of only from the change's own workspace |
| `files.exclude` | none | Folders inside a change that the file list never walks, such as raw research output |

Problems in the file show at the top of the board, and the default is used for the
broken key. The `complete` key of 0.2 is no longer read and is reported until removed.

## Apply and Finish

| Stage | Buttons |
|---|---|
| Ready, In progress | Apply |
| In review | Apply; Finish too once 80% of the tasks are ticked |
| Merged, tasks open; Complete | Finish |

When Apply and Finish would send the same text, only Apply is shown.

A change runs in its own workspace: the Orca workspace whose name or branch contains
the change's ticket key or its folder name, as a whole word (`PROJ-7`, or a branch
`feature/add-dark-mode`), and that can see the change's folder. The agents of one
workspace work on one change, so the board never sends another change to them.

| Where you are | What the card offers |
|---|---|
| The change's own workspace | Apply or Finish, sent to the agent you pick |
| Another workspace, and the change has its own | Go to that workspace |
| A folder workspace, and the change has none | Apply or Finish in a new workspace named after the change: `orca worktree create` makes a sibling folder workspace and starts `agent` there with the command |
| A Git worktree, and the change has none | A note to create a workspace named after it (a new Git worktree is left to your own setup) |

Apply and Finish type the command and press Enter. They wait while the chosen agent is
busy or asks for your approval, so the command never lands in the middle of a run. A
change or ticket name with a control character is refused, so a hostile folder name
cannot submit a second line.

## Develop

```sh
orca plugin types .
orca plugin test .
orca plugin check .
orca plugin dev watch .
```

See [AGENTS.md](AGENTS.md) for the rules of this repository.

## Licence

MIT
