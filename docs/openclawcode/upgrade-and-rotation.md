# OpenClaw Code Upgrade And Rotation

## Upgrade Path

1. sync upstream into a fresh sync branch
2. rerun:
   - targeted tests
   - `vitest.openclawcode`
   - `pnpm build`
3. refresh promotion-gate and rollback-suggestion artifacts
4. record promotion receipt only after the refreshed branch passes operator review

## Secret Handling Expectations

- keep operator secrets in host environment or external secret management
- do not store GitHub or Feishu secrets in repo-local docs or sample configs
- treat `.openclawcode/` artifacts as operational records, not secret stores

## Least-Privilege GitHub Token Expectations

- required:
  - issues write
  - pull requests write
  - contents write for merge paths
- avoid:
  - org-admin scopes
  - package or billing scopes unless a separate workflow needs them

## Least-Privilege Feishu App Expectations

- only grant the message and command surfaces needed for operator control
- keep webhook/bot credentials scoped to the intended workspace
- rotate the app secret if a bot token or signing secret is exposed

## Rotation Steps

GitHub token:

1. create the replacement token
2. update the operator environment
3. rerun strict setup-check
4. revoke the old token after verification

Webhook secret:

1. create a new secret
2. update GitHub webhook config and operator config together
3. send a probe delivery

Feishu binding:

1. update the app secret or token
2. confirm `/occode-bind` and `/occode-status`
3. rotate old credentials out of the operator host
