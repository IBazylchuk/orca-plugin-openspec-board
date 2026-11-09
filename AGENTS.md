# orca-plugin-openspec-board

An Orca plugin: a read-only board of the OpenSpec changes in the focused workspace.
`src/worker.ts` reads the disk and runs `gh`; `src/panel.tsx` draws the board;
`src/protocol.ts` is the contract between them.

## This is a public repository

Nothing here may identify the organisation this was developed in, or any person.
That applies to code, tests, fixtures, screenshots, commit messages, PR titles and
bodies alike. Never commit company, product or repository names, real change names,
tracker keys or URLs, internal hosts or paths, real e-mail addresses (including in a
co-author trailer), or a document copied from a real project as a "realistic" fixture.
Invent examples instead: `add-dark-mode`, `PROJ-7`, `example-org`,
`tracker.example.com`.

`scripts/check-no-private-refs.sh` enforces this over files and commit messages, in CI
and in the pre-commit hook (`git config core.hooksPath .githooks`). Names to screen
for go in the git-ignored `.private-refs-patterns`, one regex per line.

## Rules for the code

- The worker never writes a file. Editing belongs to the editor and the agent.
- Every value typed into a terminal goes through `applyText`, which refuses control
  characters.
- A path the panel sends is used only after it matches a file the worker listed itself.
- No runtime dependencies and no build step: Orca transpiles the TypeScript on load.

## Checks

```sh
orca plugin types .
orca plugin validate .
orca plugin test .
orca plugin check .
scripts/check-no-private-refs.sh
```

Type-check with any TypeScript 5 and `@types/node` against `.orca/types/tsconfig.json`.
