# OpenClaw Code Security And Retention

## Redaction Expectations

Stored workflow diagnostics and chat-visible status should avoid leaking:

- raw secrets
- tokens
- webhook signing secrets
- private keys
- credentials copied from operator environment

Allowed diagnostic detail:

- provider/model identifiers
- prompt/tool sizing
- high-level failure summaries
- repo-local paths that are already part of the issue workflow

## Artifact Review Scope

The review target for accidental leakage should include:

- `.openclawcode/runs/*`
- `.openclawcode/promotion-*.json`
- `.openclawcode/rollback-*.json`
- operator queue and snapshot state
- chat-visible status formatting

## 2026-03-17 Review Notes

The current repo-local review confirmed:

- saved workflow run artifacts expose:
  - provider/model identifiers
  - prompt and tool sizing counts
  - high-level failure summaries
  - rerun, takeover, and routing metadata
- saved workflow run artifacts do not intentionally expose:
  - raw tokens
  - raw webhook secrets
  - copied operator credentials
  - full provider response bodies
- operator status snapshots and chat-facing summaries expose queue, gate, reroute,
  and receipt state, but do not intentionally expose secret material
- future reviews should continue to treat repo-local paths as potentially
  sensitive if they would reveal copied-root or operator-home details beyond the
  workflow scope

## Retention Expectations

Current recommended retention policy:

- workflow run artifacts:
  - keep recent operational history
  - archive or prune old runs after they are no longer needed for reruns or audits
- operator queue and snapshot state:
  - keep live queue state indefinitely while the operator is active
  - prune abandoned entries only after manual review
- validation-pool history:
  - keep enough history to avoid reseeding duplicates
  - long-term closed validation history can be archived outside the hot path

## Security Posture

OpenClaw Code is intentionally safer when:

- provider failures are summarized instead of dumping full provider responses
- run artifacts avoid raw secret material
- operators review high-risk or policy-sensitive changes before merge
