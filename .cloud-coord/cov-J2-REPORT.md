# Cloud coverage wave J2: REPORT (jini lots 34..66)
Branch `cloud/cov-J2` (Jini), base b3c4144b (cloud/integration-2026-10-21). Tovu base was e0c935bb5 (confirmed, but not touched).
Run 15:37 → ~17:00 UTC (about 1h25m of the 4h cap). Subagents: 5 sessions (opus-high), at most 3 at once. Each confirmed it had read the TDD and Programmer personas; cmsmisc also read Architect. The coordinator reviewed every branch through the code-review persona (agents/code-review; `agents/code-inspection` does not exist).

## Headline
- 126 lot files. **125 are at 100% lines, branches and functions** on the merged branch. Coverage was re-measured after merging, against the full package suites:
  - chat: 3469 tests pass + 1 skipped (was 3260)
  - cms: 3673 pass (was 3556)
  - cms/forms: 157 (was 154)
  - cli: 574 (was 572)
- `tsc --noEmit` is clean for chat, cms, cms/forms and cli. `complexity:strict` (complexity 10 + sonarjs cognitive 10) reports 0 violations across all 61 changed TS files. The rewritten .mjs was checked with a temporary config: 0 violations.
- **The lot snapshot was stale.** Every chat file showed as NEVER-LOADED, but 76 of the 126 files were already at 100/100/100 under the real package suites. 50 files were actually below 100%.
- **Not at 100% (1 file):** `packages/cms/src/consent/html/gate.ts` reaches lines 100, branches 99.32, functions 100.
  - The uncovered branch is the fail-closed throw at line 230 ("could not normalize repeated root tags/duplicate attributes").
  - It only fires if parse5's serialise→reparse cycle is not idempotent. 40 seconds of fuzzing found no input that triggers it.
  - It was kept as a security net around a third-party parser. Unreachability can't be proven, so it was neither removed nor fake-tested.

## Per group (before → after: lines / branches / functions)
**react** (chat react components and hooks; merged 11c9e3e2): everything below → 100/100/100.
- ext-event-renderer-registry 42/44, 22/23, 9/9
- MessageList: branches 28/29
- MidRunUserMessage: branches 18/20
- composer-discovery: branches 57/61
- assistant-chats 2/370, -, 0/1 (had no tests)
- fab-position 3/159, -, 0/5 (had no tests)
- last-conversation-store 53/55, 25/27
- useComposer 213/215, 108/111, 3/4
- useConversation: branches 120/121
- useCopyToClipboard 43/47, 8/11
- useRunStream 138/141, 58/64

**pane** (chat-pane; merged 3b354d7b): everything below → 100/100/100.
- create-mcp-ui-tool-caller: branches 29/30
- model-options: branches 55/57
- ChatPane.tsx 579/585, 132/133, 35/36
- useAgentRuntimePicker: branches 94/95
- useChatPane 602/604, 272/284
- useChatPaneControlsHeight: branches 6/7
- useChatPaneFileDrop 58/61, 27/28
- useChatPaneSurface: branches 7/8
- useRuntimeDropUp: branches 37/39

**store** (chat store/server; merged 56e1b601): everything below → 100/100/100.
- durable-runs/accept 0/15
- durable-runs/entry 0/3
- store/index 0/1
- store/contracts/index 0/2
- runtime/chat-expiry-sweep 0/47
- runtime/entry 0/6
- run-guarded-chat-store 0/23
- run-ledger 0/169

**cmsct** (cms content-types and entries; merged 42be52da/929d030a): everything below → 100/100/100.
- content-types/cleanup 92.3/80/100
- lifecycle-dispatch 100/100/25
- lifecycle 88.7/65.5/100
- repo.memory 73.9/100/61.5
- tool-registrations 53.3/72.7/54.5
- entries/lifecycle-dispatch 100/100/33.3
- entries/repo.memory 92.6/91.2/100
- entries/tool-registrations 47.6/87.5/54.5

**cmsmisc** (cli, cms/forms, cms comments/consent/packaging; merged fc2bf60e): everything below → 100/100/100, except gate.ts (see above).
- cli/introspection: branches 83.3
- forms/errors: functions 90
- forms/forms 98.8/99.0
- forms/submit-service: branches 94.4
- cms/scripts/check-packaging.mjs 0/0/0
- comments/errors, index, module: 0
- comments/hooks 97/92
- comments/repo.memory 96/97.7/91.7
- comments/write-service: branches 95.8
- comments/sql/repo 98.3/96.8
- consent/css-parser: branches 96
- consent/css: branches 99
- consent/express/index: branches 99.1
- consent/express/response 97.6/97.1
- consent/html/render: branches 98.6
- consent/html/resources: branches 82.8
- consent/html/gate 99.36/96.57 → 100/99.32/100

## Bugs found and fixed
- `cms/src/content-types/tool-registrations.ts`: the agent tools passed the host's `core/ports` outbox through unchanged. Events arrived with no `id`/`workspaceId`/`occurredAt`. TypeScript's method bivariance hid the mismatch. It now goes through `toContentTypeOutbox`, as entries already did, and a test checks the full event.

## Unreachable code removed (behaviour-preserving)
- chat `ChatPane.tsx` (old 277-283, 871): the "Send as a new message" button. `typedAnswerNotice` is only ever `'failed'`, because `'not-pending'` auto-queues. Its "why" comment was moved; `sendAsNewMessage` stays on the hook.
- chat `useChatPane.hooks.ts` (old 702): the `questionId === null` case. `findTypedAnswerTarget` now returns the deliverer together with the id.
- chat `useChatPane.hooks.ts` (old 558, 889, 894): `attachments ?? []`. A new `QueuedChatInput` type guarantees attachments are present.
- chat `useChatPaneControlsHeight.hooks.ts:57`: the `if (!entry)` guard. Only a single element is observed.
- chat `composer-discovery.ts:38`: the `?? ''` fallbacks. The regex already guarantees groups 1 and 3.
- chat `fab-position.ts` (pointer move/up handlers): the `if (!start)` guards. Listeners are attached only after `dragStart` is set, and removed when it is cleared.
- chat `assistant-chats.ts` `saveWithRetry`: the dead exit of `for(;;)`, rewritten as `do…while`.
- cli `introspection.ts:70,80`: `description() ?? ""`. The port is typed as returning a string.
- cms `consent/css-parser.ts:69,83`: `tokens[cursor-1]?.offset ?? 0`. A token has always been consumed at that point.
- cms `consent/express/index.ts:141`: `cookieName ?? 'jini_consent'`. The only caller already applies the default; the internal option is now required.
- cms `consent/html/gate.ts:125`: the lowercase attribute fallback. No attribute the gate removes is re-cased by parse5, and a miss still fails closed.
- cms `comments/sql/repo.ts:119`: `row?.n ?? 0`. COUNT with no GROUP BY always returns a row. A zero-count test runs on SQLite and PGlite.

## Refactors for testability
- `createChatRunLedger` takes an optional `{ now = Date.now }` clock. A `toolKey` helper removes a duplicated nested ternary.
- `useComposer` has an optional `pageLifecycle` port. The default is the exported `browserPageLifecycle()`, and `ComposerPageLifecycle` is exported from react/index.
- `create-mcp-ui-tool-caller`: split into `postToolCall` and `timeoutAware`.
- `cms/scripts/check-packaging.mjs`: now pure exported checks with fs/console/exit ports, and `main()` runs only as the entry point. CLI output is unchanged.
  - Run against the real tree it exits 1, because `src/media/video-frames.ffmpeg.ts` reads `process.env`. That problem predates this wave and was left out of scope.
- `cms/vitest.config.ts`: coverage `include` now also has `scripts/**/*.mjs`. This adds measurement; nothing was excluded.

## Characterizations and follow-ups (not fixed, out of scope)
- assistant-chats: a message delta that arrives after its conversation was deleted is still written to the deleted chat, and that write 404s. A test pins the current behaviour.
- entries agent tools pass `principalKind`, but entries revisions do not store it, so that provenance is lost. Fixing it needs a change in entries/write-service.ts.

## Environment
- Node 24.22.0, `pnpm install --frozen-lockfile`, `pnpm -r build`: all green.
- Per the owner override, Postgres and Playwright were not installed or run. SQL paths were tested in-process on SQLite and PGlite.
- **LOCAL-RUN NEEDED: none.** No Postgres-only or browser tests were written.
- vitest needs `--minWorkers=1` alongside `--maxWorkers=2`; without it tinypool refuses to start.

## Caps used
- About 1h25m of the 4h cap.
- 5 of 15 subagent sessions, at most 3 at once.
- All 33 lots (34..66) are done. No lots are left over for the next wave.
