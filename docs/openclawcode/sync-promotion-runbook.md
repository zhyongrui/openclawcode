# Sync, Promotion, and Rollback Runbook

This runbook defines the preferred way to keep the fork close to
`openclaw/openclaw:main`, validate a refresh branch, promote it, and recover if
the promotion regresses the long-lived operator.

## Sync Cadence

- preferred cadence: run one upstream sync slice at least every 7 days
- hard threshold: open a forced sync slice immediately when the active
  integration branch is `>= 150` commits behind `upstream/main`
- branch naming:
  - `sync/upstream-YYYY-MM-DD`
  - if the same day already has an active branch, suffix with `-refresh`,
    `-b`, or `-c`

## Preflight

Commands:

```bash
git fetch origin --prune
git fetch upstream --prune
git rev-list --left-right --count HEAD...upstream/main
git status --short
```

Expected outputs:

- `git rev-list --left-right --count` prints `<ahead> <behind>`
- if `behind >= 150`, treat the sync as required instead of optional
- `git status --short` must be empty before starting the sync branch

## Sync Branch Creation

Commands:

```bash
git switch main
git pull --ff-only origin main
git switch -c sync/upstream-2026-03-16-refresh
git merge --no-ff upstream/main
```

Expected outputs:

- branch creation succeeds without touching `main`
- merge either succeeds directly or stops for conflict resolution on the sync
  branch only

## Required Validation

Run all of these from the sync branch after conflict resolution:

```bash
pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1
pnpm build
openclaw code promotion-gate-refresh --repo-root . --json
openclaw code rollback-suggestion-refresh --repo-root . --json
```

Expected outputs:

- `vitest.openclawcode` ends with `Test Files 8 passed (8)` or a higher pass
  count if the suite grows
- `pnpm build` exits `0`
- `promotion-gate-refresh --json` emits:
  - `"schemaVersion": 1`
  - `"ready": true` when the branch is promotable
- `rollback-suggestion-refresh --json` emits:
  - `"schemaVersion": 1`
  - `"recommended": true`
  - a non-empty `"targetRef"`

## Promotion Checklist

1. confirm the sync branch is green with the validation commands above
2. confirm `.openclawcode/promotion-gate.json` reports `"ready": true`
3. confirm `.openclawcode/rollback-suggestion.json` reports `"recommended": true`
4. fast-forward `main` or merge the validated sync branch into `main`
5. record the promotion receipt immediately

Receipt command:

```bash
openclaw code promotion-receipt-record \
  --repo-root . \
  --actor operator \
  --note "Promoted validated sync branch" \
  --promoted-branch main \
  --promoted-commit-sha "$(git rev-parse HEAD)" \
  --json
```

Expected output:

- JSON with:
  - `"schemaVersion": 1`
  - `"exists": true`
  - `"promotedBranch": "main"`
  - `"promotedCommitSha"` set to the promoted commit

## Rollback Checklist

Use this when a promoted sync regresses the live operator or the post-promotion
proof matrix turns red.

1. inspect `.openclawcode/rollback-suggestion.json`
2. restore the recommended baseline ref
3. record the rollback receipt immediately
4. rerun setup-check and the branch validation commands on the restored baseline

Suggested restore commands:

```bash
git switch main
git reset --hard "$(jq -r '.targetCommitSha' .openclawcode/rollback-suggestion.json)"
```

Receipt command:

```bash
openclaw code rollback-receipt-record \
  --repo-root . \
  --actor operator \
  --note "Rolled back to previous good baseline" \
  --restored-branch main \
  --restored-commit-sha "$(git rev-parse HEAD)" \
  --json
```

Expected output:

- JSON with:
  - `"schemaVersion": 1`
  - `"exists": true`
  - `"restoredBranch": "main"`
  - `"restoredCommitSha"` set to the restored baseline

## Disaster Recovery

Use this when both the promoted branch and the normal rollback suggestion are
suspect or incomplete.

1. stop operator-side automation that could enqueue more work
2. fetch `origin` and `upstream` again to recover branch metadata
3. inspect the latest promotion and rollback receipts:

```bash
openclaw code promotion-receipt-show --repo-root . --json
openclaw code rollback-receipt-show --repo-root . --json
```

4. if the latest promotion receipt exists, restore the recorded rollback target
   or the last known good `main` commit from the receipt chain
5. rerun:

```bash
pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1
pnpm build
bash scripts/openclawcode-setup-check.sh --strict --json
```

6. only restart live operator traffic after all three commands return success

## Current Example

The most recent validated refresh branch used this exact pattern:

- branch: `sync/upstream-2026-03-16-refresh`
- upstream baseline: `13894ec5aa`
- validated merge commit: `cee3261212`
- follow-up feature commits remained on the same branch and were pushed only
  after `vitest.openclawcode` and `pnpm build` passed again
