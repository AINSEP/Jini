# daemon-frontend (branch `wave2/daemon-r7`, both repos)

Base: `origin/wave2/daemon-r7` (Jini `7d74131e`, Tovu `6e7c0df6`). Plan: `R7-ROUTES.md` revision 3, section 12. Unattended, no subagents, Node 24.22.3 in `~/.local/node24`.
Status: **PARTIAL. F0, F1, F2a done (both halves). F2b, F3, F4 and the remaining G3 rows, and Z, not started: stopped on the context budget, not on a STOP rule.**

## Commits (all pushed fast-forward to `wave2/daemon-r7`)

| Repo | SHA | What |
|---|---|---|
| Jini | 35d8f28d | F0 A12: the `capability` query shapes of the session stream pinned against today's Express/qs answers (11 rows; the 4 D-FS1 rows are named in their titles). Mutation (skip instead of refuse) turned 4 rows red; restored. |
| Tovu | 0cc33ff1 | F0 A2, A3, A5, A6, A7, A8 (no source change): spoofed forwarded-for shares one socket quota; one trusted hop takes the rightmost address; Set-Cookie bytes (frozen Date) and `Secure` for three trust x forwarded-proto rows including `HTTPS,http` (Secure false, origin protocol https); `Referrer` beats `Referer`; absent `Host` prints `undefined`; admin `tabId` (repeated, bracketed, after 1000 parameters: no owner; header wins; the principal the auth layer wrote). Each seen red under its break (first forwarded hop, Secure from the forwarded protocol, referer header only, tabId from a URL parser) and restored. |
| Jini | 891dfb54 | F1: `nodeRequestHeaders({ incoming })` exported from `@jini-ai/http-kit/node-bridge`; test first (3 rows red because the export did not exist); `toWebRequest` calls it; 47 bridge tests green. Changeset. |
| Jini | 166176d7 | F2a Jini half: `frontend-hook-input.ts`; `createFrontendGuestScope` takes `FrontendHookInput`, required `isSecureRequest`, `issue` returns `{ tabCredential, setCookie }` (the cookie text is Express's, pinned byte for byte by the unchanged guest-cookie characterization rows); no Express import left in the file; signing moved to `createCredentialCodec` (the factory sat at 57 lines). Mutation (Secure fixed false) turned 2 rows red. Changeset. |
| Tovu | 2dea0ffd | F2a Tovu half: `contracts/core/request-facts.ts`, `server/inbound/shared/request-facts.ts`; `mountJiniRoutes` seeds `locals` with the facts per dispatch; `allowsVisitorRequestOrigin`, `visitor-frontend-control`, `site-assistant-confirm` on the hook input; credentials route sets the two headers itself and sends `{ tabCredential }` only; the two `catch { sendStatus(403) }` lines hand the error to a required `reportError` (wired to the site-assistant reporter; same 403 bytes). Pins A4 (9 rows) and A9 added. |

## Gates (exact command, result)

Jini, `/home/user/Jini` (`pnpm install --frozen-lockfile`, `pnpm --no-bail -r build`, no errors), tree 166176d7:
- `npx vitest run src/http --maxWorkers=2 --minWorkers=1` in `packages/daemon`: 66 files / 2120 tests pass. `npx vitest run src/__tests__/node-bridge*.test.ts` in `packages/http-kit`: 47 pass. `npx tsc --noEmit -p tsconfig.json` in daemon and http-kit: 0 errors.
- `pnpm -s guard`, `check:size`, `check:complexity`, `check:errors`: exit 0 each; `check:errors` output byte-identical to the base output (recorded on the stashed tree).
- STOP check (no `from 'express'` in `frontend-guest-scope.ts`, `frontend-hook-input.ts`): clean. Owner limits: `npx eslint --rule '{"max-lines-per-function":["error",50],"complexity":["error",10],"max-lines":["error",500]}' packages/daemon/src/http/frontend-*.ts packages/http-kit/src/node-bridge.ts`: only `createFrontendControl` (76 lines, on the base already; not touched yet) is over.
- not run: `check:hooks`, `api:update` (`api-baseline` is stale on the base; it also has to take `frontendGuestScope`'s changed shape and `nodeRequestHeaders`).

Tovu, `/home/user/Tovu`, linked to Jini 166176d7 (`JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`; `packages/contracts` and `packages/sdk` built):
- BASE-RED: base outputs recorded first on the unmodified tree (`check:size` exit 1, `check:complexity` exit 1, `check:errors` exit 0, `check:architecture` exit 1). After 2dea0ffd: `check:size` and `check:complexity` identical to base (the first run showed `createSiteAssistantModule` 185 -> 186; fixed by joining two lines); `check:errors` identical except "17 entries improved" -> "18" (the two catches that now name their error); `check:architecture`: no new line; the existing ratchet line "module API surface (files exposed) regressed 821 -> 852" reads "-> 853" (the new `contracts/core/request-facts.ts` is imported across module boundaries by design) and propagation numbers moved by 0.01-0.02.
- `npx tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.tests.json --noEmit`: 0 errors.
- Trust/address pin command from section 12.7 (`--test-name-pattern="IP session cap|spoofed X-Forwarded-For|rightmost|Referrer|Secure|tabId"` over `visitor-frontend-control.unit.test.ts` and `admin-frontend-owner.unit.test.ts`): 13 tests, 13 pass, exit 0, at F0 and after F2a.
- Focused source-reading set (27 files naming the visitor control, confirm route, `mountJiniRoutes`, `visitor-services`, the site-assistant module, `frontend-sessions`): 861 tests, 851 pass, 10 fail at first; 7 of those were the confirm route's Express fake lacking `secure`/`query`/`method` (fixed in the commit: 29/29 pass); the 3 remaining fail identically on the stashed base (`assistant-daemon-activation`, `tab-event-source.park`, `desktop-assistant-admission`: cannot load `electron`/known set).
- STOP checks run: raw-peer-address grep clean and tested on a planted case (fires); why-comment diff printed 3 reworded JSDoc lines (listed `reworded:` in the commit message) and 1 code line that matched only because it contains `//`.
- Complexity of `allowsVisitorRequestOrigin` went 10 -> 11 with the `?? 'undefined'`; fixed by extracting `servingOrigin`. The one remaining eslint error in `visitor-frontend-control.unit.test.ts` (the F3b class-guard test, 67 lines) is on the base.

## Changed answers for the owner

None. Every pin that existed or was added in F0 is green before and after F2a; the address, trust decision, serving protocol, `Secure` and owner answers come from the same Tovu functions as before. D-FS1 (the `capability[...]` query shapes) has NOT been applied yet (it lands with F2b); its 4 rows are pinned today's way.

## Left, next step

1. **F2b (pair)**: Jini `frontendSessionRoutes({ deps, host }, _optional)` per section 12.3 rows 1-5 (hand-built stream route, `gated` responses route with `frontend-session-owner`, required `setTimer`, `searchParams.getAll('capability')` + `capability[` refusal = D-FS1, hooks take `FrontendHookInput`, owner-hook throw -> 500 + request ID on the stream and 403 + report on responses); `frontendControl.routes`; preset mount; `reference-web/src/daemon.ts`; harness `mountList`; route-table literal; A10, A11; the 4 D-FS1 rows move to the refused answer. Tovu: `agent-daemon-scope.ts` frontend lines to `mountJiniRoutes`, `adminFrontendOwner({ request, locals, workspaceId })` reading `facts.query.tabId`, visitor `:59` mount with `parserLimitBytes` read from `json-body-parsers.ts`; delete the one-line Express adapter in `visitor-frontend-control.ts`.
2. F3 `frontend-request-route`; F4 `surface-restoration` + `surface-callback`; the remaining G3 rows (`message-relay`, `tool-execution-routes`, `attachments`); Z.
3. Owner: confirm or reject D-FS1 (Rec: accept; see `daemon-frontend-fix-REPORT.md`).

## Overlaps with parallel runs
Tovu: `apps/website/src/server/runtime/composition/jini-routes.ts` (one line + import), `modules/site-assistant.ts` (the `frontend` block moved below `reporter`), `assistant/site/*`, `server/inbound/public-http/routes/site-assistant-confirm.ts`. Jini: `packages/daemon/src/http/index.ts` (one type export), `packages/http-kit/src/node-bridge.ts`, `.changeset/` (two new files). No processes left running.
