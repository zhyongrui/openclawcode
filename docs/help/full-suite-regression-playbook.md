---
summary: "How to debug regressions that only appear in shard/full-suite runs, based on issue 149"
read_when:
  - A targeted test passes but the owning shard or full pnpm test still fails
  - A Vitest worker dies from process.exit or uncaught global state pollution
  - You are fixing test-gate regressions and want the shortest path to stable green
title: "Full-Suite Regression Playbook"
---

# Full-Suite Regression Playbook

This document captures the reusable lessons from closing issue `149`, where the
repo had reached a state where:

- `pnpm build` and `pnpm check` were drifting in and out of red
- targeted tests were often green while shard or full-suite runs were red
- some failures were real runtime regressions
- some failures were test-isolation or worker-behavior bugs that only surfaced
  under Vitest pool/full-suite scheduling

Use this as the default playbook when a red gate is hard to reproduce.

## Fast triage order

When a large gate is red, do not start from `pnpm test` and guess.

Preferred order:

1. `pnpm build`
2. `pnpm check`
3. targeted file(s)
4. owning shard config
5. full `pnpm test`

Useful commands:

```bash
pnpm exec vitest run src/some/file.test.ts
pnpm exec vitest run -c test/vitest/vitest.commands.config.ts
NODE_OPTIONS='--max-old-space-size=8192' pnpm test
pnpm check
```

Why this order worked during `149`:

- `build` exposed real API/type drift first
- `check` caught TypeScript and lint issues even when tests were green
- targeted runs made real logic regressions cheap to fix
- shard runs exposed cross-file pollution that single-file runs hid
- full-suite runs exposed pool/worker-only problems

## If a test passes alone but fails in the shard/full suite

Assume shared state pollution before assuming product logic is wrong.

This was the main pattern behind multiple `149` failures.

Typical causes:

- module-scope mocks not reset between tests
- `vi.mock(...)` using non-hoisted state
- cached plugin/discovery state leaking across tests
- process-global mutations such as `process.argv`, `process.exit`, or timers
- assertions depending on registration order or lazy-loading internals instead
  of the public behavior

Debug sequence:

1. Run the single failing test alone.
2. Run the whole file.
3. Run the owning shard config.
4. Compare whether the failure only appears after earlier tests have run.
5. If yes, audit module-scope mocks, `beforeEach`, and process-global cleanup.

## Rules that came out of issue 149

### 1. Use `vi.hoisted(...)` for module-scope mock functions consumed by `vi.mock(...)`

If a mocked module closes over top-level `vi.fn()` values, prefer:

```ts
const someMock = vi.hoisted(() => vi.fn());
```

instead of:

```ts
const someMock = vi.fn();
```

Why:

- it is more robust under Vitest hoisting and pooled/full-suite execution
- it avoids "works alone, fails in the shard" behavior

This mattered in:

- [plugin-install.test.ts](/home/zyr/pros/openclawcode/src/commands/channel-setup/plugin-install.test.ts)

### 2. Reset every shared mock that can affect branching, not just the ones under direct assertion

Do not stop at `vi.clearAllMocks()`.

If a test file shares module-level mocks, `beforeEach` should restore the
important default behavior explicitly with `mockReset().mockReturnValue(...)` or
`mockResolvedValue(...)`.

This mattered in:

- [bot.test.ts](/home/zyr/pros/openclawcode/extensions/feishu/src/bot.test.ts)

In `149`, two Feishu pairing tests passed alone but failed in the full file
because an earlier inbound-claim test left shared behavior in a state that
short-circuited the pairing reply path.

### 3. Do not make `process.exit` throw in tests unless you have no safer option

In Vitest worker pools, "throw from `process.exit`" tests are more brittle than
they look. A test can appear fine locally and still kill the worker during
parallel execution.

Prefer:

```ts
const exitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation((() => undefined) as typeof process.exit);
```

then assert the call happened.

Only use the throwing form when the code path truly requires the throw to stop
execution and there is no stable alternative.

This mattered in:

- [build-program.version-alias.test.ts](/home/zyr/pros/openclawcode/src/cli/program/build-program.version-alias.test.ts)

### 4. When testing lazy CLI registration, assert the current public behavior, not an old implementation detail

Several CLI regressions in `149` were not runtime bugs; the tests were pinned to
earlier assumptions about when `registerSubCliByName(...)` should be called.

Guideline:

- assert parse behavior, exit code, or command availability
- avoid asserting that a specific lazy-registration helper is always called
  unless that call is itself the contract under test

This mattered in:

- [run-main.exit.test.ts](/home/zyr/pros/openclawcode/src/cli/run-main.exit.test.ts)
- [program.smoke.test.ts](/home/zyr/pros/openclawcode/src/cli/program.smoke.test.ts)

### 5. For bundled plugin discovery, test override roots and sibling `dist` roots together

Bundled discovery bugs were easy to miss because one fix could break the other:

- overriding `OPENCLAW_BUNDLED_PLUGINS_DIR`
- preserving metadata-based resolution into sibling `dist/extensions/...`

The stable rule after `149` is:

- an override must not blindly trust bundled metadata for the source root
- but it must still allow metadata to resolve into a real built sibling `dist`
  root when that path exists

Reference files:

- [discovery.ts](/home/zyr/pros/openclawcode/src/plugins/discovery.ts)
- [bundled-plugin-metadata.ts](/home/zyr/pros/openclawcode/src/plugins/bundled-plugin-metadata.ts)
- [discovery.test.ts](/home/zyr/pros/openclawcode/src/plugins/discovery.test.ts)
- [loader.test.ts](/home/zyr/pros/openclawcode/src/plugins/loader.test.ts)

### 6. Prefer platform-compatible timer typings in tests

Do not hand-cast ad hoc timer implementations to `typeof setTimeout` with a
narrow callback signature.

Prefer:

```ts
.mockImplementation((...args: Parameters<typeof setTimeout>) => {
  return 0 as unknown as ReturnType<typeof setTimeout>;
})
```

Why:

- avoids TypeScript drift between DOM/Node timer signatures
- survives stricter `pnpm check` type gates

This mattered in:

- [setup.finalize.test.ts](/home/zyr/pros/openclawcode/src/wizard/setup.finalize.test.ts)

## How to localize a full-suite-only failure

If `pnpm test` fails but direct file runs pass:

1. identify the owning shard from the output
2. rerun that shard config directly
3. if the shard still fails, fix it there first
4. if the shard passes, suspect:
   - pooled worker behavior
   - process-global pollution
   - cross-shard runtime/env interactions

Examples from `149`:

- `build-program.version-alias.test.ts` only showed its worker problem under
  the CLI shard/full suite
- `plugin-install.test.ts` passed alone and as a file, but failed inside the
  commands shard until its mocks were hoisted properly

## What to do before you push a “green” claim

Do not say the issue is done until all three are true:

1. `pnpm build` passes
2. `pnpm check` passes
3. `pnpm test` passes

Issue `149` looked “mostly fixed” multiple times before the final pass, because:

- targeted tests were green while shard/full runs still failed
- `pnpm test` was green while `pnpm check` still had a strict TS failure

The repo-level definition of green is the gate set, not the last targeted run.

## Recommended habits for future regressions

- When you fix a flaky or polluted test, document the underlying failure mode in
  the test or nearby docs, not just the assertion change.
- When a full-suite-only failure turns out to be mock hoisting or process-global
  state, prefer improving test isolation over weakening the assertion.
- If a failure was caused by a real runtime regression plus a testing problem,
  fix the runtime first, then make the test more stable.
- Keep targeted regression tests for real bugs even after the shard/full-suite
  issue is fixed.

## Reference changes from issue 149

High-signal files from the `149` recovery:

- [discovery.ts](/home/zyr/pros/openclawcode/src/plugins/discovery.ts)
- [bundled-plugin-metadata.ts](/home/zyr/pros/openclawcode/src/plugins/bundled-plugin-metadata.ts)
- [bot.test.ts](/home/zyr/pros/openclawcode/extensions/feishu/src/bot.test.ts)
- [run-main.exit.test.ts](/home/zyr/pros/openclawcode/src/cli/run-main.exit.test.ts)
- [build-program.version-alias.test.ts](/home/zyr/pros/openclawcode/src/cli/program/build-program.version-alias.test.ts)
- [plugin-install.test.ts](/home/zyr/pros/openclawcode/src/commands/channel-setup/plugin-install.test.ts)
- [setup.finalize.test.ts](/home/zyr/pros/openclawcode/src/wizard/setup.finalize.test.ts)

Use them as examples when a future gate regression has the same shape.
