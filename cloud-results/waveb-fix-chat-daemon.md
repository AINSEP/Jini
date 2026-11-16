# Wave B fix: packages/chat + packages/daemon

Branch `fix/wave-b-chat-daemon` (Jini), from `origin/integ/wave-b` @ ab8711ed8. Base compared: `origin/refactor/terra` (worktree `../base`).
Env: Node 24.22.3, pnpm 10.33.2, `pnpm install --frozen-lockfile` OK in both trees. `pnpm -r --no-bail build`: desktop-host, ui, daemon fail in BOTH trees (pre-existing); wave B also fails capability-providers, http-kit, plugins, cms, provider-plugins, admin, chat (chat fixed here; the others are out of scope).
Vitest: `--maxWorkers=2 --minWorkers=1`, per package.

## Totals

| | base (terra) | integ/wave-b before | after this branch |
|---|---|---|---|
| chat tests | 5 failed / 5 files | 176 failed / 23 files | **5 failed / 5 files** (the same 5 as base) |
| chat `tsc --noEmit` | 0 errors | 5 (+1 TS2742 surfaced once those cleared) | **0** |
| daemon tests | 12 failed / 5 files | 381 failed / 23 files | **12 failed / 5 files** (the same 12 as base) |
| daemon `tsc --noEmit` | 9 errors | 9 (same) | 9 (same, pre-existing) |

## NEW root causes (wave B), fixed

1. **Chat store typed against the core kernel contract only partially** (C3 import rewrite, 035c2fa1). Most store files moved to core `StorageKernel<Kysely<DB>,DB>`, but `store/sqlite/index.ts` kept db's `KyselyKernel` and `store/runtime/run-ledger.ts:193` called `kernel.query`, which the core contract lacks. That gave 5 tsc errors (TS2339/2345/2739) and broke the chat build. Fix: sqlite adapters take the core type. run-ledger runs `kernel.run(db => sql....execute(db)).rows`, which is exactly db's `query` implementation (`db/src/kernel/kernel-core.ts:155`), so it uses the same executor and stays under the write lock. I also annotated `renderWithChatSurfaces`'s return type (TS2742). → **916480bd8**
2. **Chat renders lacked `UiKitProvider`** (C9-ui moved ui's selects and secret inputs behind an injected kit). This caused 141 tests / 15 files to fail with "need <UiKitProvider kit={...}>". C9-ui had already added `react/__tests__/ui-kit-render-support.tsx` but nothing used it. `renderWithChatSurfaces`/`renderHookWithChatSurfaces` now render through it, and 5 files that call `render` directly import it. → **9f244a72b**
3. **Daemon route tests mocked the origin check where the guard no longer reads it** (C4 moved `guardSameOrigin` into `@jini-ai/core/contracts/server`, which calls `isLocalSameOrigin` via a core-internal relative import). 19 test files mocked `isLocalSameOrigin` on the `@jini-ai/core` barrel, so every header-less request got 403. This was about 360 of the 381 daemon failures. The tests now spy on `guardSameOrigin` at the specifier that daemon handlers and http-kit's `mountJsonRoute` import (`http/__tests__/fixtures/same-origin-gate.ts`). The rejecting path runs core's REAL guard, so the 403 assertions are unchanged in strength. → **595eec6b0**
4. **The fake `ChatSurfaces.page.getModelContext` always returns undefined** (C10). 21 `useChatPaneAgentControl` cases that install `document.modelContext` saw no registration. They now bind agentic's `getAgentModelContext`, the detector hosts bind. → **a55b47e31**
5. **Card tests that assert the bound real implementation ran against fakes** (C10). These are the real MCP-UI sandbox iframe and frame sizing (4), the registry shadcn/recharts/data-table components (3) and ChatPane WebMCP registration (1). The new test-only `react/__tests__/host-chat-surfaces.tsx` binds exactly what Tovu's `jini-surfaces.ts` binds, and only those 8 cases use it. → **9486d7a5a**
6. **db renamed `StorageKernel`→`KyselyKernel`** (99b40765a). The daemon packed-consumer declaration test still used the old name (TS2305). → **0cf28cdfc**
7. **Real bug: `daemon/src/terminal.adapter.ts` had an inline-`type` named import from `@jini-ai/core/contracts/runtime`** (wave B split). Under type stripping it survives as a runtime side-effect import, so loading the adapter required core. terminal-optional-peer got ERR_MODULE_NOT_FOUND instead of the node-pty feature error. I changed it to `import type`. The test failed first, and reverting the change makes it fail again. → **d25847668**
8. **Protocol became a required chat dependency** (C10, 7b601411). The neutral packed consumer still installed agentic for core's A2UI projection, so `@jini-ai/chat/core` hit ERR_MODULE_NOT_FOUND `@jini-ai/protocol` (2 tests). It now installs protocol's runtime tree. Both manifest contracts move protocol from optional peers to dependencies. → **0e155f9ec**

## PRE-EXISTING (identical on terra), left alone

- chat `src/__tests__/dbpkg-chat-manifest.test.ts:28-30` and `src/store/__tests__/manifest.test.ts:20`: expect `^0.6.10` peers, but the manifest says `^0.7.0` (0.7.x release seal).
- chat `src/__tests__/dbpkg-chat-neutrality.test.ts:22`: "Tovu"/"apps/website" in comments at `src/core/assistant-client/transport.ts:139,146,603` and in `src/react/hooks/assistant-chats-contracts.ts`.
- chat `src/store/__tests__/loads-without-driver.test.ts:74`: the peer-free `store` consumer's declarations need `@jini-ai/core/list-page` (`dist/store/ports.d.ts:3`), but core is not installed there.
- chat `useChatPaneAgentControl.test.tsx:201`: expects `/streaming/`, but the message is "A reply is still running…".
- daemon `src/http/__tests__/routines.test.ts:436+` (8 tests) plus tsc `:787,:809`: the parse now returns `cursor: null` (`src/http/routines.ts:272`), and the tests predate it.
- daemon agent-sessions FK (sqlite/pglite/pglite.socket, `__tests__/sql-contract.ts:26`): the store wraps the driver FK error as `AgentSessionStoreError('unavailable')`, while the test expects the raw driver message.
- daemon `src/agent-executor/__tests__/mid-run-user-message.test.ts:168`: the warn second arg is `"Error"`, but the test expects `"event replay unavailable"`.
- daemon tsc: `src/http/tool-execution-routes.ts:235`, `src/http/xai.ts:796-801` (exactOptionalPropertyTypes).

## Design questions

- `chat/src/store/sqlite/index.ts` still runtime-imports `@jini-ai/db/kernel/sqlite` for the `createChatHistoryStore({db})` compatibility wrapper, and chat still depends on `@jini-ai/db` and `@jini-ai/agentic`. Should the wrapper move to the host or to db, so that chat/store imports only core?
- Chat tests now import real implementations from `@jini-ai/ui/*`, `@jini-ai/ui-kit/react` (via C9-ui's support helper) and `@jini-ai/agentic/dom`, and not only `/testing` or `/conformance` entries. The alternatives are a ui `/testing` kit and a surfaces conformance suite run by ui/agentic, or moving the 8 "real implementation" card cases into ui. R5 was planned to move tests to a fake ui kit.
- The `isLocalSameOrigin` barrel-mock pattern is also used in http-kit tests (adapter/origin/index). Those likely broke the same way (out of scope here). core could expose a test seam (`/contracts/server/testing` origin policy) instead of each package spying on `guardSameOrigin`.
