# Command Capability Map

`openclaw code capability-map-show --json` exposes a stable machine-readable
map tying together the main `openclawcode` command surfaces.

Contract version:

- `contractVersion: 1`

Current top-level fields:

- `contractVersion`
- `chatCommands`
- `cliCommands`
- `workflowArtifacts`
- `runtimeRoles`

Semantics:

- `chatCommands[*]` records the main operator-facing chat commands and the
  capability ids they expose.
- `cliCommands[*]` records the main machine-readable or operator-facing CLI
  commands and the capability ids they expose.
- `workflowArtifacts[*]` records the main durable files or JSON surfaces that
  carry state between runs.
- `runtimeRoles[*]` records the stable planner/coder/reviewer/verifier/
  doc-writer role surface and the steering stages currently relevant to each
  role.

Intended use:

- operator onboarding
- automation that needs a stable command inventory
- refactors that need a single place to check which surface owns which
  capability

Usage:

```bash
openclaw code capability-map-show --json
openclaw code capability-map-show
```
