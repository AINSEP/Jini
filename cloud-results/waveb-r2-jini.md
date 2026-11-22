# Wave-B round 2 — Jini fix run (2026-11-16)

Branch `fix/wave-b-r2-jini` (from `origin/integ/wave-b-fixed` @ b7666092). Node 24.11, pnpm 10.33.2. Clean-tree baseline: `pnpm -r build` had only the daemon failure.

## Gates before → after
| gate | before | after |
|---|---|---|
| `pnpm -r build` | daemon 9 TS errors | all packages build |
| `pnpm -r typecheck` | 10 errors (daemon 9, neutral-host 1) | 0 |
| `tsc -p scripts/tsconfig.json` | 3 errors | 0 |
| `pnpm guard` | 79 (N1 35, N2 34, HW3 8, R10 1, injection-debt-stale 1; R13 lines are info, not violations) | 0 |
| `pnpm check:size` | FAIL (1 new, 4 worsened, 2 lowered, 1 stale) | pass (259 entries) |
| `pnpm check:complexity` | pass | pass |

## What changed
- daemon: `XaiHttpDeps.onInternalError` accepts `| undefined`; catalog route no longer forwards undefined; routines tests carry `cursor: null` (parse returns it).
- neutral-host test uses `forWorkspace({ workspaceId })`. scripts: `gen-host-ports` drops `Map.groupBy`/unsafe cast.
- N1/N2: 35 files' comments say "the host app" instead of naming the consumer (meaning kept).
- HW3: constant Map/Set tables typed `ReadonlyMap/ReadonlySet`; the two module counters (chat A2UI action ids, ui fake excalidraw) became per-instance refs; 7 stale hardwiring-ledger entries removed. R10: chat react barrel exports `Icon`/`IconName`. injection-debt ledger shrunk by 1. No debt re-keyed to hide anything.
- size: `createOtelObservabilityPort` 97 → <50 lines (per-tracker module functions, behaviour unchanged, tests pass); A2uiSurfaceCard.hooks, run-ledger, runtime-core, builtin-features back at/below ledger; lowered entries re-keyed, stale diagnostics entry dropped.
- Changesets: chat (Icon export), daemon (exact-optional deps).

## Tests classified vs terra (no code diff in package ⇒ pre-existing)
Fixed (stale expectation vs documented/deliberate contract, test-only unless noted):
- ui `execution/index.test` (catalog ships empty `preferredModels` by design), `sign-in-card` (read abort reason after abort).
- cms forms repo.dialects (update stores service-computed version), seo.analyze (meta carries row version), sqlite surface (new core dep).
- daemon agent-sessions FK ×3 (store wraps driver error as `unavailable` + cause), mid-run-user-message (logger prints error class only).
- chat ×4 (manifest pins 0.7.0, packed store needs core, pane refusal wording), user-management ×3 (code: typed `_options` on 3 exported hooks; tests: integer-aware parser), vibecoding region-parser message, admin ×27 (only an AdminApiError's words reach the screen — plain Errors show the fallback; tests updated, `AdminApiError` kept where the message is the point).
Still failing, not fixed:
- cookie-consent `bundle.smoke` — client.min.js 4585 B gzip, 23 B headroom < 32 B pin; package source identical to terra ⇒ toolchain/esbuild-version (pre-existing). packages/cookie-consent/src/__tests__/bundle.smoke.test.ts:57.
- agent-runtime `connection-guard` — EINVAL vs socket hang up (sandbox network; ENV).
Not run: examples/notes-app, reference-web (node:test suites).

## Commits
- 518c0765 test(admin): only an AdminApiError's words reach the screen; plain Errors show the fallback (27 stale expectations)
- f7ea2d50 test(vibecoding): region-parser count message counts every mention (hero + stray = 2 vs 1)
- ddf0ab7b test(chat): manifest pins follow 0.7.0; packed store install carries core; pane refusal wording
- f43c26b3 test(daemon): agent-session FK failure surfaces as the unavailable boundary error; logger prints error class only
- 73e0d192 fix(user-management): type optional-arg params of exported hooks; tests follow integer-aware parser contract
- 20d47148 test(cms,sqlite): align stale expectations with the current contracts (stored version, version in resolved meta, core dep)
- 6130898d test(ui): presets pin no model ids (designed contract); sign-in abort test reads reason after abort
- cda164c1 chore(size): bring worsened files back to ledger; re-key lowered entries, drop stale diagnostics entry
- 47a86d17 refactor(provider-plugins): split createOtelObservabilityPort into per-tracker functions
- e7b9e13d fix(chat): export Icon from the react barrel (guard R10); changesets
- 755aa068 fix(guard): HW3 module state instance-owned/readonly; shrink hardwiring ledger
- c7698fe7 chore(guard): shrink injection-debt ledger (chat sqlite type-import gone)
- 9f958f4d docs: tidy wording
- ff44971c docs: rephrase consumer-naming comments as 'the host app' (guard N1/N2)
- a250dc88 fix(scripts,examples): gen-host-ports without Map.groupBy/unsafe cast; neutral-host test uses object-arg forWorkspace
- 859b5855 fix(daemon): exactOptionalPropertyTypes in xai/tool-execution deps; routines tests carry cursor
