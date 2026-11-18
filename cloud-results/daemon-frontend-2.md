# daemon-frontend-2 (branch `wave2/daemon-r7`, both repos)

Base: `origin/wave2/daemon-r7` (Jini `3e42f59e`, Tovu `c023be66`). Plan: `R7-ROUTES.md` revision 3, section 12. Unattended, no subagents, Node 24.22.3 in `~/.local/node24`.
Status: **PARTIAL (budget). F2b, F3, F4 done (both halves). The remaining G3 rows (`message-relay`, `tool-execution-routes`, `attachments`) and Z not started.** Stopped on the context/tool-call budget, not on a STOP rule.

## Commits (all pushed fast-forward to `wave2/daemon-r7`)

| Repo | SHA | What |
|---|---|---|
| Jini | 8c00e560 | F2b: `frontendSessionRoutes({ deps, host })` (hand-built SSE stream route on `createSseStream`, gated responses route with `frontend-session-owner`, required `setTimer`, `parseCapabilityQuery({ searchParams })` with the D-FS1 refusal, hooks take `FrontendHookInput`); `FrontendControl.routes({ host })`; preset mounts the list with `nodeSessionTimer`; `reference-web` uses `.routes`; harness `mountList`; route-table rows; A10 added; `createFrontendControl` split (76 -> under 50 lines); injection-debt allowance lowered. |
| Tovu | cb23ea95 | F2b: admin `agent-daemon-scope` mounts `frontendControl.routes`; `adminFrontendOwner({ request, locals, workspaceId })` reads `facts.query.tabId`; visitor Express adapter line deleted, capacity key = facts' `clientAddress`, visitor mounts the list through ports the composition lends; `PUBLIC_JSON_BODY_LIMIT_BYTES` (parser selector `json-body-parsers.ts:88`, `publicParser` `:82`, "128kb" = 131072) pinned ±1; A7/A8 through the real mount path; A11. |
| Jini | 949d111f | F3: `frontendRequestRoutes` on the line stream (15 s keepalive on `host.scheduler`), same three plain-string bodies; owner-hook throw is the same 403 and now reaches the host sink; new `tool-execution-stream.ts` (`writeToolExecution`, `wireError`). |
| Tovu | 4773c30a | F3: one `mountJiniRoutes` line for the page-request route, owner hook = `adminFrontendOwner`. |
| Jini | 4125c092 | F4: `restoreSurface` (`{ handled: false }` or `{ handled: true, response }`, first frame commits via the latch, keepalive starts after it) replaces `tryRestoreSurface`; `deliverSurfaceCallback` takes `scheduler` + `signal`, returns a `Response`; `createLineStream` takes a `signal`. New `surface-restoration` tests. |
| Tovu | 30aa6073 | F4: `assistant/surface-answer.ts` (`answerSurface`), `assistant.ts` and `mcp-ui-tool-calls-route.ts` use it; required `scheduler` dep on `registerMcpUiToolCallsRoute` (25 test call sites updated). |

## Gates (exact command, result)

Jini (`/home/user/Jini`, tree 4125c092; `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build`, no errors):
- `npx vitest run src --maxWorkers=2 --minWorkers=1` in `packages/daemon`: 237 files pass, 4735 tests pass, 1 skipped. `packages/server`: 508 pass, 1 skipped. `packages/http-kit`: 575 pass. `npx tsc --noEmit -p tsconfig.json` in daemon and server, `tsc --noEmit` in `examples/reference-web`: 0 errors.
- `pnpm -s guard`: exit 0 (after fixing two violations on the way: a `Tovu` word in a comment, and the injection-debt allowance for `frontend-sessions.ts`). `pnpm -s check:size` 0, `check:complexity` 0 (after splitting `deliverSurfaceCallback`: cognitive 13 -> under 10), `check:errors` 0 and its output differs from the F2a tree only by "10 entries improved" (was 9: the swallowed catch in the page-request route is gone).
- STOP check `rg -n "from 'express'" packages/daemon/src/http/frontend-sessions.ts frontend-control.ts frontend-guest-scope.ts frontend-hook-input.ts frontend-request-route.ts`: no hit (planted case was run in the previous report).
- Owner limits: `npx eslint --rule '{"max-lines-per-function":["error",50],"complexity":["error",10],"max-lines":["error",500]}' packages/daemon/src/http/frontend-*.ts packages/daemon/src/http/surface-*.ts packages/daemon/src/http/line-stream.ts packages/daemon/src/http/tool-execution-stream.ts packages/http-kit/src/node-bridge.ts packages/server/src/route-host.ts`: clean.
- Mutations (each seen red, restored): hook input with `client` (A10), refusing `capability[` removed (6 rows), capacity check `instanceof` removed, keepalive removed and owner-report removed (frontend-request), `restoreSurface` reason test and thrown-restore line changed (surface-restoration).
- Why-comment diff: printed lines are listed as `reworded:` in each commit message.
- not run: `check:hooks`, `api:update` (`api-baseline` is stale on the base; it also has to take `frontendSessionRoutes`, `frontendRequestRoutes`, `restoreSurface`, `nodeSessionTimer`, `FrontendSessionTimer` and the removed names).

Tovu (`/home/user/Tovu`, tree 30aa6073, linked to Jini 4125c092 with `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`; `packages/contracts` and `packages/sdk` built):
- BASE-RED: base outputs recorded first (`check:size` 1, `check:complexity` 1, `check:errors` 0, `check:architecture` 1). After 30aa6073: `check:size` and `check:complexity` outputs identical to base (one `createSiteAssistantModule` +1 line was fixed by joining two lines); `check:errors` identical; `check:architecture`: the same 4 regressed lines as base, no new line; the existing line "module API surface (files exposed) regressed" reads 821 -> 854 (base 853: the new shared file `assistant/surface-answer.ts` is imported across modules by design); informational numbers moved by 0.01-0.02.
- `npx tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.tests.json --noEmit`: 0 errors.
- Trust/address pin command from section 12.7: 13 tests, 13 pass, exit 0 (at F2b and again on the final tree). Raw-peer grep `rg -n "client\??\.address" apps/website/src/assistant ...request-facts.ts`: no hit.
- Source-reading sets (files naming the visitor control, frontend sessions, `createFrontendControl`, `admin-frontend-owner`, `agent-daemon-scope/server`, `jini-routes`, `registerMcpUiToolCallsRoute`, `modules/assistant`, `json-body-parsers`): F2b run 1580 tests, 1576 pass; F3 run 1453, 1449 pass; F4 run 1455, all pass after fixes. The only failures at any point: "an identity re-seed failure from a non-built-in owner role conflict ..." and "the real daemon answers component-catalog search, describe, and a 404 over real HTTP" (the latter answers `a live run is required` from `agent-daemon-scope.ts:1426`, a guard this work did not touch). **Not verified on the base tree** (the base Tovu cannot build against the new Jini); both are outside every file this run changed.
- `sites/tovu-dev/.form-files-protected-v1` is a file the test run creates; it was removed before each commit.

## Changed answers for the owner

The sheet itself (section 12.3/12.4) decides these; none is outside it:
1. **D-FS1 applied**: `capability[]=a`, `capability[0]=a`, `capability[25]=a` on the frontend session stream are now refused with the stream's error event (they were accepted as `['a']`); a `capability` after the 1000th query parameter is now counted (it was ignored). Direction: refusal, not a wider grant; no client sends either. The 4 pinned rows moved with it. Still needs the owner's explicit yes (not in the decided list).
2. An owner hook that throws on the stream answers **500 + request ID** (was a bare 403 `sendStatus`); on the responses route it stays 403 and now also reports. Same for the page-request route (403, now reported).
3. Plain refusals (`403 Forbidden`, `429 Too Many Requests`) carry a `Content-Length` and no `ETag` (DM-ETAG, decided).
4. A restored card's keepalive now counts 15 s from the first card frame (it counted from the start of the restore); it still never writes before the first frame.
5. `onInternalError` is gone from the frontend-session deps (the host's reporter owns the incident); Tovu did not use it.
The resolved client address, trust decision, serving protocol, `Secure` flag and owner answers are unchanged: all pins identical before and after.

## Left, next step

1. Remaining G3 rows: `message-relay` (48 lines), `tool-execution-routes` (Express `streamToolExecution` can now be replaced by `writeToolExecution` on `createLineStream`; the gate, the loopback peer check through `client.address`, `authorizeRun`, the catalog route), `attachments` (raw upload, section 3.2).
2. Z: delete `http-kit/src/raw-sse.ts` once no consumer is left (its last daemon user is gone; check `createSseResponse` exports and Tovu), update `api-baseline`.
3. Owner: confirm or reject D-FS1.

## Overlaps with parallel runs
Tovu: `server/runtime/composition/jini-routes.ts` (now `nodeSessionTimer`, `nodeIntervalScheduler` exported), `modules/site-assistant.ts` (one line in `createSiteAssistantModule`), `modules/assistant.ts` (`proxyMcpUiToolCall`), `agent-daemon-scope.ts` (frontend and `registerMcpUiToolCallsRoute` lines), `assistant/site/*`, `assistant/mcp-ui-tool-calls-route.ts`, 25 test files naming `registerMcpUiToolCallsRoute`, `server/inbound/shared/json-body-parsers.ts`. Jini: `packages/daemon/src/http/index.ts`, `.changeset/` (three new files), `scripts/injection-debt.json` (one line removed), `packages/server/src/{builtin-features,index,route-host}.ts`, `examples/reference-web/src/daemon.ts`. No processes left running.
