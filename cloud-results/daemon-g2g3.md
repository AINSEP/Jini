# daemon-g2g3 (branch `wave2/daemon-r7`, both repos)

Base: `origin/wave2/daemon-r7` (Jini 684a63bf, Tovu 24595f1f). Unattended run, no subagents, Node 24.22.3 in `~/.local/node24`. About 50 min wall clock; stopped on context budget, not time.
Status: **PARTIAL. G2: 3 of 6 files done (`remote-run-events`, `runs`, `memory`). G3 and Z not started.**

## Commits (all pushed fast-forward to `wave2/daemon-r7`)

| Repo | SHA | What |
|---|---|---|
| Jini | 784d5d0a | `remoteRunEventRoutes({ deps, host })` replaces `registerRemoteRunEventRoutes`; Express gate `requireRemoteToolBridgeToken` becomes web-standard `remoteToolBridgeTokenGate` (core `bearerTokenFromHeader` + `timingSafeTokenMatch`, constant-time compare from `host.timingSafeEqual`), attached per route with `gated` (gate name `remote-bridge-token`), runs before the body is read. `deps.env` is now required (no `process.env` default; env-access debt entry removed). No Tovu half (Tovu does not call it). |
| Jini | a9498587 | `runRoutes({ deps, host })` replaces `registerRunRoutes`, `registerRunEventStream`, `handleRunEventStreamRequest`. SSE built on core `createSseStream` with the lazy commit latch (first frame or first refusal wins), replay queued as `backlog`, `keepAliveMs: false`, no same-origin gate (as before), `SSE_CHARSET_HEADERS` (new `sse-wire.ts`). Core: `lastEventCursor` reads no cursor from a repeated `afterCursor` (test red first; needed so the pinned "nothing when afterCursor is repeated" stays green). |
| Tovu | 533e1d46 | pair of a9498587: scope, 3 test fixtures, the eval harness mount `runRoutes` through `mountJiniRoutes` on the line `registerRunRoutes` stood on; run-ownership source-reading test looks for that statement. |
| Jini | a908d3a8 | `memoryRoutes({ deps, host })` replaces `registerMemoryRoutes` and `registerMemoryEventStream`; the change feed is a `Response`, origin check before anything is subscribed, all three listeners removed in one `onClose`. Preset and `examples/reference-web` mount the list. No Tovu half. |
| Jini | f506b3d3 | DM-MEM (own commit): the six store-calling memory routes answer a fixed sentence plus request ID, real error to `MemoryHttpDeps.onInternalError`; `note not found` stays 404. 12 tests seen red against the old answer first. |
| both | report commits | this file |

## Decisions I made (flag if you disagree)

1. **Status for DM-MEM is 500 `INTERNAL_ERROR`** (what the reporter returns), not 400. The decision text gives the sentence and ID, not the status. A store-side validation text (`note entry requires name and a valid type`) is now the generic sentence too. If you want 400 kept, change `storeFailure` in `memory.ts` only.
2. **Gate on the two remote-run-event paths is per route (POST only).** Express `app.use(path, gate)` also answered other methods on those paths (401 without token). Now a GET/PUT there falls through to the next layer (404). Not pinned by any characterization row; listed here as the one answer that moved outside the pins. The route-table pin changed from two `USE` gates to `[remote-bridge-token]` on each route (and the "3 path gates" test is now "1 path gate").
3. **Runs stream reports a failure after commit to the host sink too** (before: only ended the stream; "errors never swallowed"). The client answer is unchanged.
4. **Runs stream: a lifecycle that throws synchronously** is reported like a rejection (caught by a failing pin: it had become a framework 500 page). Wrapped in an async closure, with a test.
5. `reportInternalError` is a required field on memory's route deps (`MemoryRouteDeps`, taken from the host) so memory.ts needs no http-kit import (the injection-debt entry is removed). For runs and remote-run-events it stays optional with the http-kit fallback (same as the previous run's decision 1) and their debt counts stay at 1.
6. Empty `:runId` 400 branch of the runs stream dropped: the route table never matches an empty segment (comment names this).

## Pins

Characterization matrix (273 tests) green after each file. Rows changed: route-table literals (gate names; remote-run-events two `USE` rows -> `remote-bridge-token`; "100 routes and 1 path gate"), and the three memory rows `400 ... leaks-dependency-message` -> `500 INTERNAL_ERROR` (DM-MEM, decided). No STOP was needed. Test counts (before -> after, same files): remote-run-events+auth-gates 110 -> 111, runs 71 -> 71, run-messages 9 -> 9, route-manifest 14 -> 14, index 8 -> 8, memory 75 -> 76 (+ DM-MEM tests); core sse +2. Mutation checks done and seen red: bridge gate removed, `===` instead of the port, backlog removed, heartbeat re-enabled, sync-throw wrapper removed, store text re-leaked.

## Gates (exact commands, results)

Jini, in `/home/user/Jini`, `--maxWorkers=2 --minWorkers=1`, final tree f506b3d3:
- `npx vitest run`: core 197 files / 2945 pass; daemon 236 files + 1 skipped / 4725 pass + 1 skip; server 32 files / 508 pass + 1 skip. All source-reading and characterization tests included.
- `npx tsc --noEmit -p tsconfig.json` in core, daemon, server; `tsc -p .` in `examples/reference-web`: 0 errors. Builds of core, daemon, server ok.
- `pnpm guard`: ok; output differs from base only by `HW9-env-access: 76 -> 75` (the removed `process.env` read). `pnpm check:size`, `check:complexity`, `check:errors`: output identical to base. `pnpm check:hooks`: exit 1 on base as well, output identical. `pnpm api:update` still not run (baseline already stale on the base; it now also has to include `runRoutes`, `memoryRoutes`, `remoteRunEventRoutes`, `remoteToolBridgeTokenGate`, `MemoryRouteDeps`, `MemoryInternalErrorContext`).
Tovu, in `/home/user/Tovu`, linked to Jini a9498587 (`link-jini.mjs`; `packages/contracts` and `packages/sdk` built), BASE-RED rule:
- `npm run check:size`, `check:complexity`, `check:architecture` (all exit 1 on base), `check:errors` (exit 0): output identical to base, no new line (`agent-daemon-scope.ts` edits are 1:1 line replacements).
- `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.tests.json --noEmit`: 0 errors.
- `run-ownership` 14/14, `run-scoped-credential` and `assistant-proxy-routes` pass. Focused source-reading set (43 files naming the scope, `daemon-source`, `jini-routes`, `daemon-catalog`, `runRoutes`, plus `assistant/__tests__/integration/*`) run as `TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=2`: 397 tests, 382 pass, 15 fail; the 15 are the known set (13 `typed-tools.integration` `executorDefinitionPolicies is not defined`, component-catalog site binding, memory-mode CLI launch). Nothing new.
- `development/scripts/__tests__/desktop-assistant-admission.integration.test.ts` cannot run here (`Cannot find module 'electron'`, not installed in this container); it typechecks.

## Push note

The Tovu push did not touch `apps/desktop`, so the pre-push hook skipped the desktop gates; no `--no-verify` was used. Jini pushed without bypass. Every push was `git pull --rebase` first; nothing forced.
Release dependency (unchanged): the website and desktop resolve `@jini-ai/daemon` from npm, so `runRoutes` exists there only after the next Jini publish (DX-OD10).

## Not done / next step

1. G2 remaining, in this order: `terminals` (SSE with deferred-end gate: prove "attach to an exited session delivers all replay frames then ends" before deleting `createDeferredEndGate`; replay as `backlog`; 404 after `abandon()`), `frontend-sessions` + `frontend-control` (`resolveOwner({ request, locals })`, `res.sendStatus` -> text/plain Response, TTL timer as a required `setTimer` dep, `withRouteMiddleware` owner gate; Tovu `visitor-frontend-control.ts` and scope line for `frontendControl.httpExtension` -> `routes`), `model-proxy` (6 SSE routes, provider not awaited before the return, DM-R3-3 fixed sentence + ID, text to the sink; own commit after the plain conversion).
2. G3: `attachment-lookup-routes`, `message-relay` (start from d2's version), `tool-execution-routes` (+ four Tovu gate sites, DM-R3-1 500 for a failing run store, DM-R3-4 keep the refusal and fix the design row), `frontend-request-route` + `surface-*`, `frontend-guest-scope`, `attachments`, then D3. DM-R3-2: add no Tovu key pattern unless Tovu's tokens have a fixed prefix.
3. Z only after G3 and R9. Recipe per file is the runs/memory pair: Jini `xRoutes` + preset `mountRoutes` + `index.ts` + manifest parity + tests on `createInMemoryServer` (`fakes/sse-reader.ts` is the new frame reader for SSE tests) + harness `mountList` entry + route-table literal; Tovu: scope line, source-reading tests.
4. `api-baseline` regeneration still open.

## Overlaps with parallel runs

Tovu: `apps/website/src/server/inbound/assistant/agent-daemon-scope.ts` (one import-list edit and the `runRoutes` statement, line count unchanged), `run-ownership.test.ts`, `run-scoped-credential.test.ts`, `desktop-assistant-admission.integration.test.ts`, `development/evals/tool-search-caller2-compliance-harness.ts`, comment-only edits in `modules/assistant.ts`, `assistant-proxy-routes.test.ts`, `assistant-live.pins.journey.ts`. Jini: `packages/server/src/builtin-features.ts` (one import line, three pack calls), `examples/reference-web/src/daemon.ts` (memory mount), `scripts/injection-debt.json` and `scripts/env-access-debt.json` (entries removed or lowered), `packages/core/src/contracts/server/sse.ts`, `packages/daemon/src/http/index.ts`, `HOST-PORTS.md`, `CAPABILITIES.md`. No processes left running.
