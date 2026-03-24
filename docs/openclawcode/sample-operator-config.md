# Sample Operator Config

```json
{
  "plugins": {
    "openclawcode": {
      "repos": [
        {
          "owner": "example",
          "repo": "service-repo",
          "repoRoot": "/srv/repos/service-repo",
          "baseBranch": "main",
          "triggerMode": "approve",
          "notifyChannel": "feishu",
          "notifyTarget": "chat:primary",
          "builderAgent": "codex-main",
          "verifierAgent": "codex-main",
          "testCommands": [
            "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"
          ],
          "mergeOnApprove": false
        }
      ]
    }
  }
}
```

Recommended environment alongside this config:

- `GH_TOKEN`
- `OPENCLAW_STATE_DIR`
- optional adapter env vars for coder/verifier reroutes
- optional `OPENCLAWCODE_MODEL_FALLBACKS` for controlled fallback proofs
