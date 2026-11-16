# C11-ids — PARTIAL (Jini side done; Tovu callers and applier pass not done)

Branch `wave-b/C11-ids` (Jini, from refactor/terra b7666092). Tovu HEAD b28d38c6 (not edited, no Tovu branch).
Commits: 2d0216d6 (move), agent-runtime, chat A2ui, chat/mcp, cms, daemon/server, b0ee1ca6 (chat history store + size debt) + this report.

## Done
- §1: `platform/src/system.ts` new; both fns deleted from core `ids.ts`/`time.ts`; platform `./system` export + `jini.entries` ("universal") added; `.changeset/platform-system-adapters.md`; READMEs/spec updated; file-lock.ts imports `../system.js`; 5 Jini examples repointed.
- §3 sites, clock now required: 3.1 `listElevenLabsVoiceOptions` (clock in required; per-clock WeakMap client cache), 3.2 `A2uiSurfaceCard` prop + hook, 3.3 `createSqlChatStore` + sqlite/pglite/postgres wrappers + `createChatHistoryStore` ({db,scope,clock}), 3.4 `MediaRowCleanupDeps.clock` (PurgeMediaDeps inherits), 3.5 `createSqlAgentSessionStore` + 3 wrappers, 3.6 `createKernelSqliteEventLog`, 3.7 `createSqliteEventLog`/`openSqliteEventLog` (clock in `input`; `SqliteEventLogOptions.clock` removed), 3.8 `sanitizeTokensFile`, `isTokenExpired`, and (cascade) `readTokensFile/getToken/setToken/clearToken/readAllTokens` take `clock` in required; `McpTokenClockOptions` export removed, 3.9 NOT DONE (see below).
- Package tests use local fakes (no platform import). 4 daemon tests (surface-callback, tool-recovery x3) inline fakes.
- `scripts/size-debt.json`: bindSqliteEventLog 106 -> 105 (ratchet demanded it).

## SKIPPED / NOT DONE
- 3.9 `user-management/src/server/seed.ts` `ensurePrincipal`: not reached (context budget). Still imports createSystemClock from core primitives -> user-management will not build until done.
- Tovu callers/hosts (A2uiSurfaceCard registration, RoutedA2uiSurfaceCard, cms purge deps, chat store, token store callers if any) and the 214 repoint rows: not touched.
- Examples/other Jini hosts passing the new required clock: `server/kernel-base.ts` uses `createSystemClock()` from `@jini-ai/platform/system`.
- Coordinator: `examples/notes-app/package.json` and `examples/reference-web/package.json` need `@jini-ai/platform` (reference-web also imports platform/system now); lockfile.

## Debt retired
`injection-debt.json`: `packages/core/src/primitives/ids.ts globalThis` (guard reports it stale). The sheet's `time.ts` has no entry.

## Checks
- core primitives tests 94 pass; platform system+fs tests 846 pass; cms media-service 62 pass; daemon store/tool-recovery/surface-callback tests pass except below; chat store + A2uiSurfaceCard tests pass except below. complexity ratchet pass; size ratchet pass after the debt edit.
- LANE-CAUSED guard: `SI-optional-peer kernel-base.ts` (server default path reaches optional peer platform; needs platform as required dep of server or clock threaded through kernel options) and `SI-domain platform/src/fs/file-lock.ts reaches src/system.ts` (cross-entry import now that `./system` is its own entry). The sheet's instruction for file-lock conflicts with the guard: coordinator ruling needed.
- Sheet wrong: moving the whole `defaults.test.ts` to platform would drop the console-logger tests; I split it (clock/id tests moved to `platform/src/__tests__/system.test.ts`, rest stays in core). The cms test "rollbackUploadedMedia without an injected clock" tested the removed default; rewritten to assert the injected clock stamps the tombstone.
- PRE-EXISTING/ENV (tsc/build and tests, none from this lane): desktop-host logging.ts TS2379, ui build test-file errors, daemon routines/xai/tool-execution-routes TS2375/2741, chat manifest.test, chat+daemon `loads-without-driver` (packed consumers miss `@jini-ai/core/list-page`; daemon variant needs rebuilt dist), daemon agent-sessions FK tests expect FK text but the wrapper error hides it (cause shown only in `.cause`), 137 other guard violations. `vitest --maxWorkers` conflicts with cms/daemon config (omit it).
- NEEDS-APPLIER-PASS: Tovu and any importer still on `@jini-ai/core/primitives` for the two moved names.
