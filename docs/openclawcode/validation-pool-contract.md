# Validation-Pool Contract

The repo-local validation-pool CLI now exposes a stable contract version for
machine-readable issue inventory and reconciliation output.

Contract version:

- `contractVersion: 1`

Commands covered:

- `openclaw code seed-validation-issue --balanced --json`
- `openclaw code list-validation-issues --json`
- `openclaw code reconcile-validation-issues --json`

Stable top-level fields for `seed-validation-issue --balanced --json`:

- `contractVersion`
- `owner`
- `repo`
- `balanced`
- `dryRun`
- `minimumPoolTargets`
- `poolDeficits`
- `seedActions`

Stable top-level fields for `list-validation-issues --json`:

- `contractVersion`
- `owner`
- `repo`
- `state`
- `totalValidationIssues`
- `counts`
- `implementationCounts`
- `templateCounts`
- `minimumPoolTargets`
- `poolDeficits`
- `issues`

Stable top-level fields for `reconcile-validation-issues --json`:

- `contractVersion`
- `owner`
- `repo`
- `closeImplemented`
- `enforceMinimumPoolSize`
- `totalValidationIssues`
- `closableImplementedIssues`
- `closedIssues`
- `minimumPoolTargets`
- `poolDeficits`
- `seededIssues`
- `seedActions`
- `nextAction`
- `actions`

Semantics:

- `minimumPoolTargets` documents the intentional minimum open-issue counts for
  each validation issue class.
- `poolDeficits` reports the current open-issue count and missing count for
  each class relative to the minimum-pool policy.
- `seedActions` reports the balanced-pool seeding actions for the current
  invocation and uses:
  - `created`
  - `reusedExisting`
  - dry-run `created: false`, `reusedExisting: false`
- `issues` is the current validation-pool inventory after repo-local
  implementation assessment.
- `actions` is the reconciliation decision list for the current invocation and
  uses:
  - `would-close`
  - `closed`
  - `left-open`
- `nextAction` is the stable summary signal for what an operator or automation
  loop should do next.

Stability boundary:

- the top-level field names listed above are stable for `contractVersion: 1`
- nested entry fields under `issues` and `actions` are also intentionally
  stable for `contractVersion: 1`
- nested entry fields under `minimumPoolTargets`, `poolDeficits`, and
  `seedActions` are also intentionally stable for `contractVersion: 1`
- human-readable `implementationSummary` text is descriptive text and should
  not be parsed when a structured field already exists
