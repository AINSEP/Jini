# NOTES-FIX: review fixes for `cloud/notes-app`

Branch `cloud/notes-app-fix`, cut from `cloud/notes-app` at `ea1e01354`. It was not merged or rebased onto anything. The work fixes Part 1 of `cloud/reports/reviews-1108.md` (Tovu branch `cloud/reviews-1108`): one commit per finding, each staged by explicit paths. No subagents were used.

Raw output for every claim below is in `cloud/reports/raw/notes-app-fix/`.

Setup: Node 24.22.2, `pnpm install` exit 0, `pnpm --no-bail -r build` exit 0.

## Per finding

| finding | commit | what changed | evidence |
|---|---|---|---|
| P1-5 barrel re-export | `4c665f5d` | Deleted `export * from './server.js'` from `packages/core/src/index.ts`. The test and typecheck files import the contract from its own module. | `p1-5-probe.txt`, `p1-5-core-typecheck.txt` (exit 0), `p1-5-core-test.txt` (6/6) |
| P1-1 types only, under `contracts/` | `9bed3b75` | `packages/core/src/server.ts` → `packages/core/src/contracts/server.ts`, subpath `./contracts/server` (replacing `./server`). It holds only `ServerMethod`, `ServerHandler` and `Server`; the path syntax is stated in words in `Server`'s doc. `matchServerPath` and its doc comment moved to `examples/notes-app/src/node-server.ts`. | `p1-1-core-typecheck.txt`, `p1-1-example-typecheck.txt` (both exit 0), `p1-1-example-test.txt` (8/8) |
| P1-2 client address | `76cc47b5` | `ServerHandler`'s required-args object gains `readonly client?: { readonly address: string }`. The doc says adapters fill it from the socket and never from a header. The Node adapter fills it from `incoming.socket.remoteAddress`. Additive. | failing first: `p1-2-failing-first.txt` (type error, and `{ address: null }` at run time). After: `p1-2-after.txt` (9/9) |
| P1-3 spoofable IP, unpruned limiter | `57a989e9` | `POST /forms/:slug` uses `client?.address ?? 'unknown'` instead of `x-forwarded-for`. The hand-written `createFixedWindowLimiter` is replaced with `createRateLimiter` + `createMemoryCounterStore` from `@jini-ai/http-kit/rate-limit` (30 per 60 s, burst 0). The example's `package.json` adds `@jini-ai/http-kit: workspace:*`; the lockfile gains 3 lines and no external packages. | failing first: `p1-3-failing-first.txt`. 31 submissions with 31 spoofed headers: all 202, spoofed values stored. After: `p1-3-after.txt`. The 31st is 429, `source_ip` is `127.0.0.1`, 11/11, smoke PASS |
| P1-6 HEAD/OPTIONS, `@agent-note` | `3a14ea18` | `ServerMethod` adds `'HEAD'` and `'OPTIONS'`. `ServerMethod` and `ServerHandler` carry `@agent-note`. A HEAD with no HEAD route is answered by the GET route without a body (stated in the contract, done in the adapter). The 405 `Allow` header adds `HEAD` beside `GET`. | failing first: `p1-6-failing-first.txt` (`OPTIONS` is a type error, HEAD gets 405). After: `p1-6-after.txt` (13/13, smoke PASS) |
| P1-8 ever-growing `events` | `b4d74c51` | `createMemoryOutbox` and its array are gone. The outbox is `discardOutbox`, a no-op. `registerNotesApp` no longer returns `{ events }`. | `p1-8-after.txt` (type-check exit 0, 13/13, smoke PASS) |
| P1-7 args rule | `c136af9f` | These now take `(requiredObj, optionalObj)`: `html`, `json`, `redirect`, `readForm`, `toRequest`, `writeResponse`, `plain`, `parse`. So do the unlisted `noteBody`, `findBySlug` and smoke's `stop`/`check`/`post`. The `e` alias became direct `escapeHtml({ text })` calls. No behaviour change. | `p1-7-after.txt` (type-check exit 0, 13/13, smoke PASS, a grep finds no positional calls left) |
| P1-4 cms imports `@jini-ai/db` | not changed | Left as instructed. It is an existing pattern: `create-tables.ts:2`, `repo.ts:2` and `submission-ip-retention-repo.ts:2` all import `StorageKernel`/`StorageDialect` from `@jini-ai/db/kernel`. The follow-up is to move those types to `core/contracts/db` and re-point all three imports. | n/a |

### P1-5 is narrower than the review says

The review said nothing in core's root barrel named web globals before. The probe shows that is not true. A consumer with `lib: ES2023`, `types: []` and `skipLibCheck: false` already fails on `AbortSignal` in `approval.d.ts`, `object-store.d.ts`, `primitives/http.d.ts`, `surface-cards.d.ts`, `surface-exchanges.d.ts` and `tool-registry.d.ts`, plus one `globalThis` index in `records.d.ts`. That failure was there before and is still there after.

What the fix does remove is the three `Request`/`Response` errors from `server.d.ts`. So the root barrel no longer gets any worse, but such a consumer still fails.

## Excess-code cuts

| cut | where it went |
|---|---|
| `core/src/server.ts:49-78` `matchServerPath` | moved to the adapter (`9bed3b75`) |
| `core/src/__tests__/server.test.ts:78-92` matcher tests | moved with the matcher (`9bed3b75`). The whole file went: its other 3 tests only exercised an in-memory fake built on the matcher. All 6 now run against the real adapter over a socket. Test count: core −6, example +8 at that commit (+13 total by the end, in `node-server.test.ts` and `app.test.ts`). Core keeps its type-level registration checks in `args-convention.typecheck.ts`. |
| `core/src/index.ts:45` barrel line | removed (`4c665f5d`) |
| `ports.ts:31-45` hand-written limiter | replaced by http-kit's (`57a989e9`) |
| `ports.ts:22-25,50,60`, `app.ts:138` `events` | removed (`b4d74c51`) |
| `node-server.ts:73-77` second route scan for `Allow` | folded into the P1-6 rewrite of `dispatch` (`3a14ea18`). It scans once and reuses the matches for `Allow`. |
| report gap rows 9 and 12 | dropped (`e2dce8eb`). The same commit corrects rows 4, 5 and 7 to match the review's verdicts and this branch, updates the import lists, and stops calling the single-owner authorize a GAP in `ports.ts`. |

## Final checks

- `pnpm guard`: exit 1 with **2 violations, both in files this branch does not touch**. They are `packages/plugin-catalog/scripts/generate.ts` (R2 deep path) and `packages/chat/src/react/.../ChatPane.tsx` (R10). `git diff ea1e0135 -- packages/plugin-catalog packages/chat packages/agent-plugins` is empty. No violation names core, `contracts/` or the example. See `final-guard.txt`. I did not run guard on the unmodified base, so "pre-existing" is inferred from the untouched files.
- Core tests: `index.test.ts`, `source-neutrality.test.ts` and `settings-subpath-isolation.contract.test.ts` pass 9/9; `args-convention.test.ts` passes 5/5. See `final-core-tests.txt`.
- Type-checks, no emit: `@jini-ai/core` (`tsc -p tsconfig.json --noEmit`) and `examples/notes-app` both exit 0 after every commit.
- Example: `node --test 'src/**/*.test.ts'` passes 13/13, and `node scripts/smoke.ts` prints PASS after every commit from P1-3 on.

## Not done or not checked

- P1-4, as instructed.
- No downstream consumer of `@jini-ai/core/server` was searched for outside this repo. The old `./server` subpath is gone with no alias. Inside Jini, only the example used it.
- I added no test for P1-8 (it removes state) or P1-7 (a pure signature refactor). Both were verified by type-check, tests and the smoke run.
- Tovu was not touched.

## Cost

No subagents. One coordinator, with about 120k tokens of context at the end (an estimate).

NOTES-FIX DONE
