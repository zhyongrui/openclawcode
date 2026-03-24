# OpenClaw Code Proof Matrix

## Completed Repo-Local Proofs

- strict setup-check and built-startup readiness
- chat-native setup hardening proofs for:
  - explicit plugin activation readiness / chat-setup-routing visibility
  - automatic post-auth chat push after browser-side GitHub device approval
- issue-driven local runs with worktrees, build, verify, PR publication, and
  merge-policy explanation
- provider pause and compact failure diagnostics
- blueprint-first repo-local artifacts:
  - blueprint
  - work items
  - discovery
  - role routing
  - stage gates
  - promotion / rollback artifacts and receipts
- policy machine-readable snapshot and guarded merge behavior

## Completed Sync-Branch Proofs

- refreshed upstream sync branches that pass:
  - targeted conflict tests
  - `vitest.openclawcode`
  - `pnpm build`
- refreshed-branch live no-op proof on `sync/upstream-2026-03-17-refresh2`:
  - run `zhyongrui-openclawcode-134-1773744106266`
  - final stage `completed-without-changes`
  - issue closed automatically after verification
- 2026-03-21 blueprint-first sync-branch proof on `sync/upstream-2026-03-18`:
  - commit `4f47c82f808164a6063e0a4ba28b9978d7ae30d0`
  - targeted branch proof suite passed:
    - `extensions/openclawcode/index.test.ts`
      - `shows provider-role routing through /occode-routing`
      - `updates provider-role routing through /occode-route-set`
    - `src/openclawcode/testing/run-issue.test.ts`
      - `captures runtime routing selections before build and verification`
    - `src/openclawcode/testing/openclaw-plugin-integration.test.ts`
      - `formats run status updates for chat notifications`
  - result:
    - `3` test files passed
    - `4` targeted blueprint-first proof cases passed

## Remaining Live Follow-Up Proofs

- live operator proof that the hardened chat-native setup path:
  - reports plugin activation / routing readiness clearly on a fresh machine
  - pushes the next setup message automatically after browser auth completes

## External-Usable Proof Gate

Do not call the operator "externally usable" until all of these rows have a
dated proof entry:

1. fresh-host zero-to-bind proof
2. fresh-host zero-to-merged low-risk run proof
3. fresh-host zero-to-escalated-path proof
4. fresh-host zero-to-rerun-path proof
5. latest promoted baseline merged low-risk proof
6. latest promoted baseline no-op proof
7. latest promoted baseline blocked or escalated proof
8. fallback-model live proof, if a second model is configured
9. blueprint-first proof on the current long-lived baseline

Current status on 2026-03-17:

- repo-local proof rows: complete
- sync-branch proof rows: complete on `sync/upstream-2026-03-17`
- external/operator proof rows:
  - fresh zero-to-bind: complete
  - fresh zero-to-merged low-risk: complete via run
    `zhyongrui-openclawcode-130-1773737938218` and merged PR `#135`
  - fresh zero-to-escalated: complete
  - fresh zero-to-rerun: complete via failed run
    `zhyongrui-openclawcode-134-1773741281887` followed by rerun
    `zhyongrui-openclawcode-134-1773741499523`
  - latest promoted baseline merged low-risk: complete via `origin/main @ 22e43ad3cb` (`feat: implement issue #130 (#135)`)
  - latest promoted baseline no-op: complete via run `zhyongrui-openclawcode-134-1773739257883`
  - latest promoted baseline escalated: complete via run `zhyongrui-openclawcode-132-1773739717720`
  - fallback-model live proof: complete on 2026-03-17 via:
    - live operator inventory showing a second discoverable model
      (`openai-codex/gpt-5.4`)
    - long-lived proof run `zhyongrui-openclawcode-129-1773741126413`
      showing a real fallback chain auth failure
    - long-lived proof run `zhyongrui-openclawcode-134-1773741968419`
      logging `anthropic/claude-opus-4-6 -> crs/gpt-5.4` fallback handoff
      before a separate sandbox-path failure
  - blueprint-first refreshed sync branch: complete on 2026-03-21 via
    `sync/upstream-2026-03-18 @ 4f47c82f808164a6063e0a4ba28b9978d7ae30d0`
    and the targeted proof suite listed above
  - blueprint-first long-lived baseline: complete on 2026-03-21 via
    `main @ 3a7cc32af268f1313d6b762dc9cc99a7675f508e` with:
    - `extensions/openclawcode/index.test.ts`
      - `shows provider-role routing through /occode-routing`
      - `updates provider-role routing through /occode-route-set`
      - `shows repo-local runtime steering through /occode-runtime-steering`
      - `updates repo-local runtime steering through /occode-runtime-steering-set`
      - `shows handoff summary through /occode-status`
    - `src/openclawcode/testing/run-issue.test.ts`
      - `per-stage runtime steering`
    - `src/openclawcode/testing/openclaw-plugin-store.test.ts`
      - `persists structured workflow run snapshots alongside issue statuses`
    - `src/openclawcode/testing/openclaw-plugin-integration.test.ts`
      - `formats run status updates for chat notifications`
    - result:
      - `4` test files passed
      - `8` targeted blueprint-first proof cases passed

## How To Use This Matrix

- treat repo-local proofs as engineering confidence, not production proof
- treat sync-branch proofs as promotion readiness, not long-lived operator proof
- do not mark external/operator checklists complete until the live proof row is
  filled in with a dated run
