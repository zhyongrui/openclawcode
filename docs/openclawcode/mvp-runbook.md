# OpenClawCode MVP Runbook

This runbook describes how to try the current `openclawcode` workflow against
this repository.

For the webhook/chatops operator path, start with `operator-setup.md`.
This page stays focused on direct `openclaw code run ...` execution from the
repository checkout.

## What The Current MVP Can Do

The current `openclaw code run` path can:

- fetch a GitHub issue
- create a persisted workflow run record
- prepare an isolated git worktree and issue branch
- invoke an embedded OpenClaw agent as the builder
- run explicit post-build test commands
- generate draft PR metadata
- invoke an embedded OpenClaw agent as the verifier
- optionally push the branch and open a draft PR
- optionally merge after verifier approval

## Current Limits

The current MVP does not yet include:

- background queue workers
- issue suitability gating
- automatic test selection
- rich human checkpoint policy

Use it on small, well-scoped issues first.

## Prerequisites

Before running the workflow, make sure:

1. Repository dependencies are installed successfully.
2. OpenClaw local agent execution works in this checkout.
3. Your model/provider auth is already configured for local `openclaw agent` runs.
4. `GITHUB_TOKEN` or `GH_TOKEN` is exported if you want to fetch private issues, open draft PRs, or merge.
5. Git push access to `origin` is working if you use `--open-pr`.

## Recommended First Test

Create a small issue in `zhyongrui/openclawcode`, then run from the repository root:

```bash
openclaw code run \
  --issue 123 \
  --owner zhyongrui \
  --repo openclawcode \
  --repo-root /home/zyr/pros/openclawcode \
  --test "pnpm exec vitest run --config vitest.openclawcode.config.mjs"
```

This will:

- create state under `.openclawcode/`
- create a worktree under `.openclawcode/worktrees/`
- create a branch like `openclawcode/issue-123`
- run builder and verifier passes locally

## Open Draft PR

If the issue run looks healthy and push auth is ready:

```bash
openclaw code run \
  --issue 123 \
  --owner zhyongrui \
  --repo openclawcode \
  --repo-root /home/zyr/pros/openclawcode \
  --test "pnpm exec vitest run --config vitest.openclawcode.config.mjs" \
  --open-pr
```

## Auto-Merge Trial

Only try this after the draft PR path is stable:

```bash
openclaw code run \
  --issue 123 \
  --owner zhyongrui \
  --repo openclawcode \
  --repo-root /home/zyr/pros/openclawcode \
  --test "pnpm exec vitest run --config vitest.openclawcode.config.mjs" \
  --open-pr \
  --merge-on-approve
```

## Staged FS-Tool Validation

When validating the deterministic sandbox edit rewrite on a low-risk issue, use
the runner switch instead of changing code:

```bash
OPENCLAWCODE_ENABLE_FS_TOOLS=edit \
openclaw code run \
  --issue 123 \
  --owner zhyongrui \
  --repo openclawcode \
  --repo-root /home/zyr/pros/openclawcode \
  --test "pnpm exec vitest run --config vitest.openclawcode.config.mjs"
```

Use `OPENCLAWCODE_ENABLE_FS_TOOLS=edit,write` only when you intentionally want
to validate both runner-added fs tools in the same trial.

## Artifacts To Inspect

After a run, inspect:

- `.openclawcode/runs/*.json`
- `.openclawcode/worktrees/<run-id>/`
- `.openclawcode/worktrees/<run-id>/.openclawcode/builder-prompt.md`
- `.openclawcode/worktrees/<run-id>/.openclawcode/verifier-prompt.md`

## If The Run Fails

Check these first:

- GitHub token availability
- local model auth
- git push auth
- test command correctness
- verifier JSON response quality

Prefer repository-local commands such as `pnpm exec vitest ...` over `npx -p ...`
for final validation. The workflow host already runs the final test commands after
the builder finishes, so the builder agent does not need to execute the full suite
inside its sandbox.

If needed, rerun against a smaller issue with a single targeted test command.
