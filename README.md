# OpenSpec Board for Orca

A read-only board of the [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes in
the workspace Orca shows. Each change appears under its stage with its task progress,
the line you resume from, its ticket and its pull requests. Apply types a command you
choose into a running agent terminal.

Without a config it behaves like plain OpenSpec. Teams that run OpenSpec their own way
describe that in one file, `openspec/board.json`, and the board follows it.

## Install

In Orca, install the plugin from this repository's Git URL, then approve the access it
asks for: read the focused workspace, read the agent list, send text to a terminal.

The worker runs as a trusted Orca worker, with your account's access to the machine.
It only reads files under `openspec/changes`, runs `gh search prs` when you configure
pull requests, and never writes a file.

## Stages

| Stage | When |
|---|---|
| Planning | A required artifact is missing |
| Ready | Every artifact is there, no task ticked |
| In progress | Some tasks ticked |
| In review | A pull request of the change is open |
| Complete | By `complete`: every task ticked, or every pull request merged |

Archived changes are not shown.

## Config

`openspec/board.json`, every key optional:

```json
{
  "requiredArtifacts": ["proposal.md", "design.md", "tasks.md"],
  "complete": "pullRequests",
  "resumeLine": "^Next:",
  "ticket": {
    "pattern": "^proj-(\\d+)",
    "key": "PROJ-$1",
    "url": "https://tracker.example.com/browse/{ticket}"
  },
  "pullRequests": { "owner": "example-org", "search": "{ticket} in:title" },
  "apply": "/work {ticket}",
  "files": { "exclude": ["research"] }
}
```

| Key | Default | Meaning |
|---|---|---|
| `requiredArtifacts` | `proposal.md`, `design.md`, `tasks.md`, `specs` | Files or folders a change needs to leave Planning. `skip_specs: true` in a change's `.openspec.yaml` drops `specs` for that change |
| `complete` | `ticks` | `ticks`: every task ticked. `pullRequests`: every pull request found is closed and one is merged; needs `ticket` and `pullRequests` |
| `resumeLine` | none | A regular expression for the line in `tasks.md` that says what comes next; shown on the card |
| `ticket` | none | `pattern` matched against the change folder name, `key` built from its groups, optional `url` with `{ticket}` |
| `pullRequests` | off | `gh search prs --owner <owner>` with `search`, where `{ticket}` becomes up to six tickets joined by `OR`. Only pull requests whose title names the ticket count. Results are kept five minutes, and kept as they were when a search fails. GitHub allows 30 searches a minute per account, shared with your other `gh` use. Needs `gh` signed in |
| `apply` | `/opsx:apply {change}` | What Apply types; `{change}` and `{ticket}` are replaced |
| `files.exclude` | none | Folders inside a change that the file list never walks, such as raw research output |

Problems in the file show at the top of the board, and the default is used for the
broken key.

## Apply

Pick an agent terminal of the focused workspace and press Apply on a change that is
not in Planning or Complete. The command is typed and Enter is pressed. A change or
ticket name with a control character is refused, so a hostile folder name cannot
submit a second line.

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
