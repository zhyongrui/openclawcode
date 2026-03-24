# Upstream Sync Conflict History

This appendix keeps the recurring sync hotspots short and explicit.

## 2026-03-16

Conflicts during `sync/upstream-2026-03-16`:

- `package.json`
- `tsdown.config.ts`
- `src/plugins/discovery.ts`
- `src/plugins/discovery.test.ts`
- `extensions/feishu/src/bot.ts`
- `extensions/feishu/src/bot.test.ts`

Follow-up fixes after merge:

- `vitest.openclawcode.config.mjs`
- `tsconfig.plugin-sdk.dts.json`

## 2026-03-16 Refresh

Conflicts and post-merge fixes during `sync/upstream-2026-03-16-refresh`:

- `src/index.ts`
- `src/plugins/bundled-dir.ts`
- `src/plugins/bundled-dir.test.ts`
- `src/agents/pi-tools.read.ts`
- `src/agents/pi-tools.sandbox-edit.ts`
- `tsconfig.plugin-sdk.dts.json`
- `tsdown.config.ts`

## 2026-03-17

Conflicts during `sync/upstream-2026-03-17`:

- `src/plugins/bundled-dir.ts`
- `src/plugins/bundled-dir.test.ts`

## Recurring Hotspots

The sync areas most likely to need attention again are:

- plugin discovery and bundled extension resolution
- Feishu bot integration
- tsdown / declaration-build config
- test configs that need alias parity with upstream
