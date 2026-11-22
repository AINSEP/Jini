# daemon-prereqs: the four R7 prerequisites (branch `refactor/daemon-prereqs`, both repos)

Base: `origin/refactor/terra` (Jini `02edbb68`, Tovu `80b00f5b`). Run 2026-11-16, ~55 min wall clock. No subagents. Design read from `plan/daemon-untangle-design-2026-11-16` (INDEX §9, R7 §2.3/§11), `plan/untangle-gaps-2026-11-16` (GAPS §2, §4.4), `plan/terra-2026-11-15` (DESIGN, LANES).

## Items and commits

| # | Item | Jini | Tovu |
|---|---|---|---|
| 1 | C-ORIGIN-PORT | `182ef5ce` characterization (test-first), `daf4e1b5` the port | `ddaa71a6` builds on Jini `daf4e1b5`; `df058a36` holds back the desktop hunk (see Deviations) |
| 2 | G-HTTP-AUTH | `2bda0669` characterization (test-first), `89ac3ac8` the move + injected compare | `d8f354c8` builds on Jini `89ac3ac8` |
| 3 | C4-a / C4-b / C4-e | `79b19ffd` (tests written first, seen failing, then implementation) | none needed (additive) |
| 4 | P-NODE-BRIDGE | `4adba562` | none needed (additive) |

Final Jini HEAD of the branch: the report commit that follows `4adba562`; Tovu: the report commit that follows `d8f354c8`.

What each did:
1. `OriginContext` is now `{ originPolicy: SameOriginPolicyPort }`; `createLocalSameOriginPolicy({ port, env, config }, { logger })` reads `port()` per call; `core/contracts/server/testing` gains `allowAllOrigins`, `denyAllOrigins`, `createRecordingOriginPolicy`, `createTestRouteHost`. `composeJiniKernel` takes `resolvedPortRef` as its own option; the preset binds the policy (`localOriginPolicy` helper, which also kept `createLocalNodeDaemon` from growing: size-debt value 113 -> 112). 19 daemon route-test files stop mocking core's guard (`fixtures/same-origin-gate.ts` deleted; hosts built with the recording policy, or the real local policy where a real listener is used; the model-proxy "guard throws" cases use a scripted policy). Tovu: `agent-daemon-scope` and the visitor frontend control bind `createLocalSameOriginPolicy` (visitor keeps port 0 + empty env, not `denyAllOrigins`), 7 test/harness sites.
2. `bearerTokenFromHeader` -> `core/contracts/server/auth.ts` (verbatim); `isLoopbackPeerAddress` -> `core/net` using `STRICT_IPV4` (parity test in http-kit against a `net.isIP` reference over ~45 vectors incl. leading-zero octets); http-kit no longer exports either. The tool-execution caller gate and the remote bridge token gate call core's `timingSafeTokenMatch` with an injectable `timingSafeEqual` (default `node:crypto` via `daemon/src/http/node-timing-safe-equal.ts`); core testing adds `fakeTimingSafeEqual`. `route-manifest.ts` declares its own `RouteRegistration`. `injection-debt.json` lowered by 3 allowances. Tovu: `bearerTokenFromHeader` import repointed (2 files).
3. `sameOriginRefusal` (exported form of jsonRoute's private `originRefusal`; jsonRoute calls it), `withRouteMiddleware` (`withServerMiddleware` now delegates to it), `createSseStream({ keepAliveMs: false })` (no timer, nothing written idle) and `send(.., { backlog: true })` (not counted against `maxQueuedEvents`; live frames keep the cap).
4. `http-kit/src/node-bridge.ts` + tests from design-d2 `f6e1401e`, its `./server-port.js` import repointed to `@jini-ai/core/contracts/server`, new `./node-bridge` package entry, exported `sendWebResponse({ response, res }, { headOnly })` (former private writer), plus pins for body provenance, client address, HEAD/OPTIONS, `sendWebResponse`.

## Gate tests and proof they fail (deliberate local mutation, reverted each time; `git diff` clean afterwards)

- C-ORIGIN-PORT / core guardSameOrigin: mutated `isLocalSameOrigin(...)` -> `true || isLocalSameOrigin(...)` in origin.ts; core origin.test.ts: 6 tests fail (foreign origin, env allow-list, live env, port-per-call, loopback foreign, header-less foreign Host). Reverted.
- C-ORIGIN-PORT (after port): mutated guardSameOrigin to `if (true || originPolicy.isSameOrigin(...))`: core contracts/server tests: 10 fail (incl. json-route "refuses a cross-origin request"). Mutated createLocalSameOriginPolicy `port: required.port()` -> `port: 0`: 3 fail in origin.test.ts (port read per call). Both reverted (git diff clean on origin.ts vs working version).
- C-ORIGIN-PORT / Tovu run-ownership.test.ts "the daemon's same-origin policy refuses a foreign-origin run start...": mutated the test host's originPolicy to `{ isSameOrigin: () => true }`; that test fails (13/14 pass). Reverted.
- G-HTTP-AUTH / characterization (daemon auth-gates.characterization.test.ts, before the move): mutated tool-execution-routes `if (!isLoopbackPeerAddress(...)) {` -> `if (false) {`: 2 fail (non-loopback peer, look-alike addresses). Reverted. Replacing the token compare with `!==` is NOT detectable by behaviour tests (as the design predicts) - covered by the injected-compare tests below.
- G-HTTP-AUTH / after move (daemon auth-gates.characterization.test.ts, core auth/net tests): (M1) tool-exec gate token compare replaced by `presented !== expected` -> 3 fail (port never asked / verdict not the port's); (M2) same for the remote bridge gate -> 3 fail; (M3) tool-exec loopback check replaced by `if (false)` -> 2 fail; (M4) core bearer grammar loosened to optional "Bearer" -> 3 fail in core auth.test.ts; (M5) core isLoopbackPeerAddress IPv4 test loosened from STRICT_IPV4 -> 2 fail (127.1, leading-zero octets). All reverted.
- C4-a/b/e (core, tests written first and seen failing with "is not a function"/behaviour): mutations on the finished code: (A) sameOriginRefusal forced to pass -> 3 fail; (B) withRouteMiddleware drops its middleware -> 8 fail; (C) backlog frames counted against the cap -> 2 fail; (D) keepAliveMs:false ignored (timer scheduled) -> 1 fail. All reverted.
- P-NODE-BRIDGE (http-kit node-bridge.ts + tests): (M1) client address read from x-forwarded-for -> client-address test fails; (M2) drained request + no parsedBody yields '' instead of null -> body-provenance test fails; (M3) headOnly ignored in sendWebResponse -> headOnly test fails (times out 15s). All reverted.

Not detectable by behaviour tests, by design: replacing the constant-time compare with `===` (timing is invisible to a status assertion). It is caught by the injected-port tests: both gates must call the injected `timingSafeEqual` exactly once for a same-length wrong token, not at all for a different length, and take its verdict (3 failures per gate when replaced by `!==`). The compare stays `timingSafeTokenMatch` + injected `timingSafeEqual`; nothing was replaced with `===`.

Every auth/origin/body-limit/compare gate keeps its behaviour: same inputs, same answers (403 `cross-origin request rejected`, 401/403/503 codes and messages unchanged, loopback decision identical for every vector tested). No body-limit gate was touched.

## Verification (Jini, final tree)

- Tests (vitest, 2 workers): core 2792 passed, http-kit 550, daemon 4388 (+1 pre-existing skip), server 472 (+1 pre-existing skip). No test deleted: `it()` calls before -> after: core 1720 -> 1752, http-kit 352 -> 367, daemon 3341 -> 3358, server 387 -> 387 (tests moved from http-kit to core are counted in core).
- `pnpm guard` ok; `pnpm -r typecheck` 0 errors; `check:size` and `check:complexity` pass (one size-debt entry lowered 113 -> 112 and re-anchored).
- Core coverage run is under its 99% threshold both before and after (96.98% base vs 96.99% now); the uncovered lines in the touched core files are pre-existing (auth.ts, origin.ts and loopback.ts are at 100%).
- Tovu: `tsc -p tsconfig.json` clean; importer tests (run-ownership, run-scoped-credential, theme-list-files..., the daemon-catalog / execute-registered-tool / agent-daemon-* users, 40 files, 721 tests) pass. Two tests fail in `agent-daemon-import-graph.unit.test.ts` and `integration/component-catalog-routes.integration.test.ts` ("requires its site binding"); they fail identically with my Tovu changes stashed, so they are not from this work (not checked against a pristine base).
- Changesets (patch): `origin-policy-port`, `http-auth-helpers-to-core`, `core-route-gates-sse-options`, `http-kit-node-bridge`.

## Deviations and things to know

1. **Tovu `apps/desktop/src/desktop-agent.ts` hunk is not pushed.** It is the third Tovu origin site. The repo's `apps/desktop` pre-push hook runs the desktop gates, which fail in this container independent of this change (electron absent; unrelated typecheck errors at `desktop-agent.ts:485/490`, 4 NEW complexity violations in other files, coverage). `git push --no-verify` was denied by the harness, so it was not used and no other route around the hook was tried. The hunk is saved as `cloud-results/desktop-agent-origin-port.patch` (apply with `git apply`; it needs Jini `daf4e1b5`). Until it is applied, `apps/desktop` builds against the old adapter shape. Needs an owner decision: apply it where desktop gates can run, or allow the bypass.
2. Design says `createTestRouteHost` defaults to "a throwing onInternalError". I left `onInternalError` absent unless passed, so existing route tests that rely on the default internal-error logging keep their behaviour.
3. Design says `RouteRegistration` is a "3-field" shape; the code has 2 fields (`method`, `path`). Declared locally with those 2.
4. G-HTTP-AUTH: the design's `DaemonRouteHost.timingSafeEqual` (required) is R7 work. Now it is an optional dep on the two gates with a `node:crypto` default in daemon (the "no native default in daemon" end state is for R7 to reach).
5. Design §11.10 expects OPTIONS on a routed path to "fall through -> 404". Actual bridge behaviour, now pinned: with `next` it falls through to the host; with no host it answers 405 + `Allow: GET, HEAD`.
6. Server-side test hosts: where a test used the real policy over a real listener I kept the real policy (`createLocalSameOriginPolicy`) instead of `createTestRouteHost()`, so those tests still exercise real origin decisions (stricter than the design's mechanical swap).
7. `pnpm exec vitest --maxWorkers=2` alone errors on vitest 2.1.9 in these packages (min/max threads conflict); `--maxWorkers=2 --minWorkers=1` was used.
8. Environment: Node 24.22.3 in `~/.local/node24`; Jini `pnpm install --frozen-lockfile` and `pnpm --no-bail -r build` worked as is. Tovu `npm ci` worked; `link-jini.mjs` pointed Tovu at this Jini checkout. No baseline of the unmodified tree was separately recorded for Tovu's full suite (only the targeted files above).

## Next item

R7-P0 (the 12 characterization files and the 100-row matrix) is next in the design order; its prerequisites are now all on this branch. First apply `cloud-results/desktop-agent-origin-port.patch` in an environment where the desktop gates can run, and decide O-12 / O-11 (R7 §11.10, INDEX §9.5) before P0's census.

---

# Run 2 (2026-11-16, ~40 min wall clock, no subagents): P-NODE-BRIDGE-b and part of R7-P0

Status: **PARTIAL.** Item 1 done. Item 2 (R7-P0) about one third done, Jini side only. Item 3 (R7-P1) not started. No source file under `packages/daemon/src/http` changed; the only production change is in `http-kit/src/node-bridge.ts`. Tovu has no code change in this run (so no pair commit); only this report.

## Commits (branch `refactor/daemon-prereqs`, Jini; all pushed)

| SHA | What |
|---|---|
| `5cae9758` | P-NODE-BRIDGE-b: `maxReserializedJsonBytes`, the rebuilt-request header rule, 11 tests, changeset `http-kit-reserialized-body-limit` |
| `161b5e4b` | R7-P0: harness, T1 route table, T3 response matrix, T2 precedence |
| `ad29433a` | R7-P0: hand-mounted route gates, body limits (T4, T9, origin half of T6/T8) |
| `90524450` | harness typing fix |

## Item 1: P-NODE-BRIDGE-b (AMENDMENTS-A A5.1 to A5.3): done

- `maxReserializedJsonBytes({ parserLimitBytes })` = `ceil(limit x 5.25)`; 102,400 -> 537,600 and 6,291,456 -> 33,030,144, as the amendment's table says. The derivation is the why-comment on `JSON_RESERIALIZE_MAX_EXPANSION`.
- A request the bridge rebuilds from `parsedBody` gets `content-length` = rebuilt byte length and loses `content-encoding` and `transfer-encoding` (`describeRebuiltBody`). d2's bridge did not do this; before the change a gzip JSON body behind `express.json()` answered 415.
- Tests (`http-kit/src/__tests__/node-bridge-reserialized-body.test.ts`), real socket where a socket matters. Each mutation was applied to `node-bridge.ts`, seen to fail, and reverted (`git status` clean after):

| Mutation | Tests that failed |
|---|---|
| helper returns the old constant 128 KiB | 6: both exact values, both sweeps, accepted-at-limit-minus-1 and at-limit |
| expansion 5.25 -> 5 | 4: exact values, rounding, both sweeps |
| `content-encoding` kept | gzip-behind-parser (415 instead of 200) |
| `transfer-encoding` kept | chunked-body header pin |
| `content-length` not rewritten | both header pins |
| headers also stripped on a body nothing read | "gzip is still refused, never inflated" |

## Item 2: R7-P0, what exists now (`packages/daemon/src/http/__tests__/characterization/`)

- `harness.ts`: the one seam (`RouteHarness.fetch/close/routes/internalErrors`). Today: real Express on `127.0.0.1:0`, all 25 route files mounted in host order (health, the two groups with their own parser, blanket `express.json()`, the rest), real local origin policy, every dependency a stand-in that throws a marker.
- `route-table.characterization.test.ts` (T1): inline literal of all 100 routes + 3 path gates, by file, in mount order, with the layers in front of each answer.
- `response-matrix.characterization.test.ts` (T3, T2): 88 rows (83 JSON specs + the 5 other JSON-answering routes): answer to an empty same-origin request and to a foreign origin. Every `500` row also checks: request ID shape, marker text absent from the body, the sink got the original error under the same ID. 11 precedence rows + 2 no-match rows.
- `gates-and-limits.characterization.test.ts` (T4, T9, origin part of T6/T8): 32 tests.
- Counts re-run against the design: 83 `mountJsonRoute`, 17 hand-mounted routes, 3 gates, 28 `register*`, 55 same-origin specs. All match.

Proof the pins fail (source mutation, test run, revert; tree clean after each):

| Class | Mutation | Failed |
|---|---|---|
| T1 lost route | agents rescan not mounted | route table x2, its matrix row, coverage check |
| T1 gate order | tool-exec parser before gate | route table |
| T1 lost path gate | `app.use(...tool-result, gate)` deleted | route table x2, its matrix row |
| T3 same-origin removed | agents rescan `requireSameOrigin: false` | its row |
| T3 same-origin added | agents list gets the gate | its row |
| T3 SEC-005 | connectors returns `error.message` | 6+ connectors rows |
| T2 precedence | memory `/:id` mounted before `/tree` | route table + 3 precedence rows |
| T6 origin (stream) | guard removed from memory event stream | its row |
| T6 origin (none today) | guard added to the run event stream | its row |
| T9 bearer compare | remote bridge accepts any token | both remote rows |
| T9 token before body | tool-exec gate after parser | its test |
| T4 limit | attachment-lookup 64kb -> 128kb | limit+1 row |
| T9 owner gate | scoped frontend-session gate passes on a resolver error | its test |
| T7 body bytes | frontend-request plain-string error becomes an envelope | 2 tests |

## Findings and deviations

1. **Three memory routes put a dependency's error text in a 400 answer today**: `PATCH /api/memory/tree/:id`, `PATCH /api/memory/config`, `DELETE /api/memory/:id` (`memory.ts:270`, `errorMessage(error)` into `BAD_REQUEST`). The design's T3 says no body contains the thrown message. The code differs, so these rows are pinned as they are (`leaks-dependency-message`) and nothing was changed. Needs an owner decision before G2 converts `memory.ts`.
2. T3 is a two-question matrix, not the full row the design lists. **Not pinned by P0 yet:** happy status + body shape per route, and a parse-failure case per route. For the 29 routes whose empty request stops at 400, the handler-throws contract is also not reached. Today's per-file tests cover those paths on Express.
3. T1's layer column is `name/arity` because every gate is an anonymous closure; same-origin is pinned per route by the matrix, not as a T1 column.
4. The number sweep is exhaustive to 6 characters (2,584,000 tokens, count checked by an independent regex brute force); for 7 to 8 characters the mantissa digits are 0, 1, 9 with every exponent (11,788,695 tokens). The full 8-character space is too large for a unit test.
5. The header rule applies only when a body was actually rebuilt. A drained request with no `parsedBody` (body `null`) keeps its headers.
6. `JSON_RESERIALIZE_MAX_EXPANSION` is module-private; only the function is exported.
7. The blanket-parser limit pins (102,400, with the most-expanding body) cannot be broken by a daemon source mutation, because the parser is the host's. They are there to fail after conversion if a route limit is set below `maxReserializedJsonBytes`.
8. The harness ignores `fetch(.., { client })` on a real socket (peer is always loopback).
9. O-11 and O-12: the amendments do not change either, so the design's recommendation stands. O-11 accept (C4-e `backlog` landed in run 1). O-12 accept only if the P0 census finds no caller; **the census and T2b were not done in this run**, so O-12 is still conditional.

## Verification (Jini `90524450`)

http-kit 561 tests pass (was 550). daemon 4526 pass + 1 pre-existing skip (was 4388; +138). `pnpm guard` ok, `pnpm -r typecheck` 0 errors, `check:size` and `check:complexity` pass. No test deleted or loosened. Tovu: `npm ci`, `link-jini`, contracts and sdk builds ran; no Tovu test was run because nothing in Tovu changed.

## Next (in order)

1. Rest of R7-P0, Jini: T2b path classes + the O-12 caller census; T5 query shapes; T6 stream behaviour (content type, heartbeat per kind, replay incl. 1,167 events, overflow, abort cleanup, terminal exited-session, run error before/after commit); T7 NDJSON; T8 upload; T10 cookie; T12 state isolation; T11 in `packages/server`; the happy/parse rows of finding 2; sort the 17 `listen` tests (design 11.13).
2. R7-P0, Tovu: parser-chain suite (design 11.2) and the nine `authorizeRun` cases (3.5), each with its named break.
3. Owner decision on finding 1.
4. Then R7-P1.

---

# Run 3 (2026-11-16, no subagents): rest of R7-P0, and R7-P1

Status: **PARTIAL.** R7-P0 is done except for the items listed under "Not done". R7-P1 is done except for one line of preset wiring. R7-G1 was not started (context budget, not wall clock). No route file under `packages/daemon/src/http` changed behaviour; the only edit to an existing source file is one type export in `http/index.ts`.

## Commits (branch `refactor/daemon-prereqs`, all pushed)

| Repo | SHA | What |
|---|---|---|
| Jini | `68353d1b` | T6: life of the five event-stream kinds on a real socket (40 tests) |
| Jini | `adf8ec8c` | T7: the two line-stream routes; stream reader fails a route that never sends headers |
| Jini | `9611c430` | T8: upload and cleanup below the JSON parser (17 tests) |
| Jini | `928e2cb8` | T2b path matching, T5 query shapes, T12 per-mount state (24 tests) |
| Jini | `7c2ff922`, `2530a64a` | T11 in `packages/server`: token check vs parser per security profile (10 tests) |
| Jini | `8e3cc15a` | T10: guest cookie `Set-Cookie` bytes (5 tests) |
| Jini | `f4242547` | T9: where the host run check (`authorizeRun`) sits on the tool RPC (4 tests) |
| Jini | `19f587ce` | **R7-P1**: `route-host.ts`, `route-table.ts`, `sse-commit.ts`, `line-stream.ts`, fake host, `server/src/mount-routes.ts`, changeset `daemon-route-host` |
| Tovu | `7f28be21` | `authorizeRun` suite on the real `assistant-tool-exec.ts` router (14 tests; names Jini `8e3cc15a`) |
| Tovu | `1ef25f35` | Parser-chain suite on the real statements of `agent-daemon-scope.ts` (8 tests; names Jini `f4242547`) |
| Tovu | `0f9e39b4` | **R7-P1**: `composition/jini-routes.ts` + unit test (6 tests; builds on Jini `19f587ce`) |

## Pins and the mutation that fails each

Every mutation was applied to the source, the suite run, the failure seen, and the file restored with `git checkout` (tree clean after each).

**T6 streams** (`characterization/streams.characterization.test.ts`)

| Mutation | Tests that failed |
|---|---|
| runs: end event no longer ends the stream | end-event test |
| runs: stream not opened before replay is queued | 1,167-event replay; failure-after-first-event |
| runs: no unsubscribe when the client left during subscribe | that test |
| runs: failure before commit ends the stream instead of JSON 500 | that test |
| runs: cursor read from the query only | 3 cursor rows |
| memory: one `off()` removed | 5 (all listener-count checks) |
| memory: a 15 s ping added | idle test |
| memory: queue cap removed | slow-consumer test |
| terminals: deferred end replaced by a direct end | both exited-session replay tests |
| terminals: detach removed | 5 |
| terminals: cursor ignored | 2 |
| frontend sessions: ping interval 60 s | ping test |
| frontend sessions: detach removed on close | 3 |
| model proxy: stream opened before the body is validated | 400-before-stream test |
| model proxy: a ping added | no-timer test |

**T7 line streams**: headers not flushed (10 fail); abort not forwarded; keepalive added to tool-exec; `code` dropped from the throw line; keepalive removed from page requests; `release()` removed; resolver error text put in the 403; extra-field check removed. Each fails its own test. **T9 run check order**: hook removed from POST (2), hook moved before the gate and parser (2), hook removed from the catalog GET (1).

**T8 uploads**: every chunk passed through `String()` (binary round-trip fails, the corruption the design warns about); consumed-body check removed; slot not released (2); limiter removed; cleanup answers 200 with a body; activity acquired after the origin check; path cap removed.

**T2b/T5/T12**: `contextRef` accepts an array; tool-catalog `principalId` accepts an array; active-context store shared between mounts; upload counter shared between mounts. **T10**: `HttpOnly` dropped; `SameSite` lax; `Secure` forced off; `no-store` dropped; a tab credential accepted as the guest cookie. **T11**: `sidecar-strict` parser moved above the token gate (2 fail); parser limit raised to 1 MB (3 fail).

**Tovu `authorizeRun`** (mutations in `assistant-tool-exec.ts`): principal equality removed (2 fail); rewrite removed (2); read-only attenuation removed (1); workspace clause removed (1); liveness clause removed (3); run-id clause removed (1); `!runStore` guard removed (1); `forget` removed (5); `authorizeRun` not passed (13); lookup rejection swallowed (1); check skipped for the catalog GET (3).

**Tovu parser chain** (mutations in `agent-daemon-scope.ts`): `validateDelegatedRunId` removed (2 fail); parser limit back to the default (1); per-run re-resolve passes without a caller (2); parser removed, parser scoped to the delegated path, first token gate removed (8 each: these also trip the suite's assertion on the five statements and their order, so they fail as a whole rather than one case).

## Findings (code differs from what the design assumed; nothing was changed)

1. **A failing run store on `POST /internal/tool-executions` answers 400 "request body must be valid JSON".** The rejected lookup goes to `next(error)`, and the next error handler is the route's own body-parser handler. The design (§3.5) expects "the host error path answers". Pinned as it is in Tovu. The conversion must decide: keep 400, or make it a 500 (a behaviour change, needs the owner).
2. **`TOVU_API_KEY_REDACTION` does not exist** in Tovu (design §4.2 passes it to the dispatcher). `mountJiniRoutes` takes `redactionPatterns` as an option, default none (the bridge's built-in patterns still apply). Needs an owner answer on whether Tovu has a key shape to add.
3. **Model proxy: a transport failure's own message reaches the client** inside the stream (`{"type":"error","message":"<upstream error text>"}`); it comes from the provider turn, not from the route, and nothing is reported to the sink. Pinned as it is. Same class as run 2's memory finding.
4. **The proxy token is refused on the delegated path** (404 "a live run is required", from the per-run re-resolve). Design §11.2 has a row "proxy token + any `runId` passes". Pinned as it is.
5. **1,167-event replay on a real socket arrives whole** on one connection today (INDEX §9.6 asked). The frames go straight into the kernel buffer, so the 1000 cap is not reached. This supports O-11 "accept".
6. A mismatched delegated `runId` answers **403**, not 401; a run credential on a site-owned route answers 403 "cannot call POST …". Recorded in the suite.
7. `jini-local`: a loopback caller is never asked for a token, so the test cannot show whether the parser runs before the token check in that profile (moving the parser fails nothing). The rows record the answers only, and the test says so.
8. The `settled` flag in `streamToolExecution` cannot fail a test alone today: `res.writableEnded` covers the same instant. The late-emission pin becomes meaningful after conversion.

## Deviations from the design in P1

- `daemonRouteHost({ context, parserLimitBytes })`: the design's signature takes only `context`. The parser limit is a literal (`"6mb"`) in the scope file, which P1 must not touch, so the caller passes the number and the helper derives `jsonBodyMaxBytes` with `maxReserializedJsonBytes` (33,030,144 for 6 MiB).
- Tovu's interval scheduler unrefs its timers (the helpers it replaces did; the design's sketch did not).
- `createLineStream` on an already-aborted request returns an empty, ended body (as §3.3 says), not an errored one.
- `createCommitLatch(_required = {}, _optional = {})` to satisfy the args convention check.
- Only the `DaemonRouteHost` type is exported from `@jini-ai/daemon/http`; `gated`, `describeRoutes`, `createLineStream`, `createCommitLatch` stay internal until a route group uses them.
- **Not landed in P1:** `services.context.routeHost` in the preset (§11.9), and who reads the route-registration guard's inventory (§11.11). `mountRoutes` itself is landed and tested.

## Not done in P0

- T3's happy-path and parse-failure rows per route (run 2 finding 2). Today's per-file tests still cover them on Express.
- Sorting the 17 existing `listen` tests into the three layers of §11.13 (nothing was deleted or moved).
- O-12 census is partial: a search of string literals in both repos finds no caller that sends a daemon path with a trailing slash or in upper case; URL builders that concatenate were not traced. Today's answers for those spellings are pinned (T2b), so the conversion will show the difference.
- §11.15 rows not given a new harness test: frontend-session wrong owner / wrong bind token (resolver-throws is pinned), run ownership and owned-list shadowing, the principal header rewrite (existing tests in both repos cover these on Express; not re-proven by mutation in this run).
- Query shapes are pinned as "accepted or refused" per route; which element of a repeated value a route uses is not visible in that table.

## Verification

- Jini `19f587ce`: daemon 4,647 tests pass + 1 pre-existing skip (was 4,526); server 490 pass + 1 skip (was 472); `pnpm guard` ok; `pnpm -r typecheck` 0 errors; `check:size` and `check:complexity` pass. No test deleted or loosened.
- Tovu `0f9e39b4`: `tsc -p tsconfig.json --noEmit` clean; `tsconfig.tests.json` reports nothing for the three new files; the three new suites pass (14 + 8 + 6). No other Tovu test was run. No `apps/desktop` change.

## Next

1. Preset `routeHost` on `services.context` (finish P1), then R7-G1 with `tool-catalog` first, one file per pair, each gated by these pins (swap the harness mount function for that file only).
2. Owner answers on findings 1, 2 and 3, and on run 2's memory finding, before G2/G3 reach those files.
3. The P0 items above.

---

# Run 4 (2026-11-16, no subagents): P1 finished; O-12 census; R7-G1 held before the first conversion

Status: **PARTIAL, stopped on purpose.** P1 is complete. The O-12 census is done and its result is "the design's premise does not hold". A trial conversion of `tool-catalog` (local, not committed) then showed a second difference the design does not name. Both change answers a client can get today, the task says byte-identical, so **no route file was converted** and nothing that changes an answer was pushed. The trial is saved as a patch. In Tovu only one test file changed (3 tests added); no Tovu source changed.

## Commits (branch `refactor/daemon-prereqs`, all pushed)

| Repo | SHA | What |
|---|---|---|
| Jini | `bb2b3409` | **R7-P1, preset half**: `server/src/route-host.ts` (`presetRouteHost`), `FeatureBuildContext.routeHost`, built once in `composeJiniKernel`; changeset `server-preset-route-host`; 8 tests |
| Jini | `e660edad` | **R7-P0**: `characterization/tool-catalog.characterization.test.ts`, every answer of the two tool-catalog routes (28 tests) |
| Jini | `e97a4764` | `cloud-results/r7-g1-tool-catalog-trial.patch` (the trial conversion, not applied) |
| Jini | (this report's commit) | this section |
| Tovu | `7f898ad5` | **R7-P0**: 3 tests in `server/__tests__/assistant-proxy-routes.test.ts`: the admin proxy forwards a path in the client's spelling (builds on Jini `e660edad`) |
| Tovu | (this report's commit) | this section |

## 1. P1 finished

`context.routeHost` (the design's `services.context.routeHost`, §11.9) is on every feature's build context. `presetRouteHost({ context, parserLimitBytes })` binds Node timers (unref'd), `node:crypto.timingSafeEqual`, http-kit's reporter and `maxReserializedJsonBytes` (102,400 -> 537,600, A5.1).

Deviation: new optional config `jsonBodyParserLimitBytes` on `composeJiniKernel`. The design gives the preset one number, but a caller may set `installJsonBodyParser: false` and mount its own parser, whose limit the kernel cannot know. Without the option, converted routes would refuse (413) bodies such a caller's parser accepted. No in-repo host sets `installJsonBodyParser: false` today.

Mutations seen to fail, then restored: caller's limit ignored (1 test); `unref()` removed (1); context copied instead of passed (1); limit not derived (3).

§11.11's open question (who reads the route-registration guard's inventory) is answered: the guard records calls to the app's verb methods, and `getRouteRegistrationInventory` is read by **three `server` test files** (`compose-jini-kernel.test.ts`, `builtin-features.test.ts`, `builtin-features.mounts.test.ts`) and by no production code (`route-manifest.ts` names it in a comment only). A route mounted through `mountRoutes` goes through `app.use` and is not recorded, so those tests' route lists lose every converted route. Nothing was changed; per the design the first converted pack makes `mountRoutes` append to the same inventory.

## 2. O-12 census: no caller originates an odd spelling, but one forwarder passes any spelling through

Method: every non-test line in both repos that names a daemon route path (132 lines, 42 files; daemon `src/http` itself excluded), checked by script for a trailing slash, an upper-case literal segment, and a path segment interpolated without `encodeURIComponent`. Result: **0, 0, 0.** The two joiners (`mcp/daemon-client.ts:231`, `cli/http.ts:260`) are `${base}${route}` with constant routes.

What the design did not know: **Tovu's admin proxy forwards the inbound path as the client spelled it.** `assistant-daemon-client.ts:148` builds the target from `req.originalUrl`; `proxyPassthrough` uses it for `GET /api/tools/search`, `GET /api/tools/:id` (`assistant.ts:661-662`), the runs routes (`:619, :622, :623, :629`) and attachments (`:557, :701`). Neither Express app sets `case sensitive routing` or `strict routing`. So a client with an admin session that sends `/API/tools/search?q=x` or `/api/tools/search/?q=x` is matched by Tovu, forwarded with that spelling, matched by the daemon, and answered 200 today. Design §11.10 assumed "Tovu's proxy forward list is generated from constants". (A bad percent escape is refused by Tovu's own router first, so that class does not reach the daemon through the proxy.)

Pinned in Tovu (`7f898ad5`): `/API/Tools/Search?q=posts`, `/api/tools/search/?q=posts` and `/api/tools/SEARCH?q=posts` each reach the stand-in daemon with exactly that URL. Mutation: the proxy lower-cases the path and drops the trailing slash -> all 3 fail (and 1 existing test); restored.

Why "fix it in the bridge" (§11.10) is not enough: core `matchServerPath` compares literal segments exactly and literal wins over `:name`. `/api/tools/SEARCH` therefore matches `:id`. Case-insensitive matching has to be in the core route table, not in the bridge's dispatch.

## 3. Trial conversion of `tool-catalog` (local only; patch: `cloud-results/r7-g1-tool-catalog-trial.patch` in Jini)

The patch holds `toolCatalogRoutes({ deps, host })` and the harness mount swapped for that family only. It is **not a complete pair**: `http/index.ts`, the preset pack, `tool-catalog.test.ts`, `route-manifest.test.ts`, the T1 literal, API docs and the Tovu callers are not repointed.

Against the 28 pins of `e660edad`: **17 pass unchanged** (bytes of every success, every 400, both 403s, the 404, the 500 contract with its message text, request ID and sink, what the catalog is asked). **11 change:**

| Request | Today | After the trial |
|---|---|---|
| `GET /api/tools/search/?q=a` | 200 hits | 404 framework page |
| `GET /API/Tools/Search?q=a` | 200 hits | 404 framework page |
| `GET /api/tools/SEARCH?q=a` | 200 hits (search route) | **404 JSON `no catalog entry for tool id "SEARCH"`** (the other route answers) |
| `GET /api/tools/a/`, `GET /API/TOOLS/a` | 200 entry | 404 framework page |
| `GET /api/tools/%E0%A4%A` | 400 framework page | 404 framework page |
| `OPTIONS /api/tools/search`, `/api/tools/:id` | 200, `Allow: GET,HEAD` | 404 framework page |
| every success (GET) | `Content-Length`, `ETag: W/"…"` | **neither; `Transfer-Encoding: chunked`** |
| GET with `If-None-Match` (as a browser cache sends it) | 304, no body | 200, full body |
| `HEAD /api/tools/search?q=a` | `Content-Length: 109` | no `Content-Length` |

The last three rows are **new**: Express's `res.json` sets a length and a weak validator and answers conditional requests; the bridge writes the web `Response` as a stream. The design names one accepted difference (the abort answer, §2.3). §8 says a changed header is a STOP. This applies to all 83 JSON routes, not only this file.

## 4. Decisions needed before G1 can start

1. **O-12.** Either (a) accept the stricter path answers knowing the admin proxy makes them reachable by any session client, or (b) match Express first. (b) needs: a case-insensitive literal compare and one optional trailing slash in core's route table (opt-in), and the bad-escape 400 through `next(error)` in the bridge.
2. **OPTIONS** on a converted path (200 + `Allow` today). §11.10 says the bridge answers it when no CORS layer is above; nothing implements that yet.
3. **New: `Content-Length`, `ETag` and 304.** Either accept (answers become chunked, no validator), or the bridge's writer sets a length for a non-stream body and reproduces Express's weak ETag and freshness check.
4. Still open from run 3: its findings 1 to 4 (the HOLD list of this run), and run 2's memory finding.

With 1 to 3 answered, the trial patch plus the caller repoints is the first pair; the 28 pins are its gate.

## Also found

- Tovu has **source-reading tests** that name the register functions: `inbound/assistant/__tests__/daemon-source-roots.unit.test.ts:13` asserts the scope calls `registerToolCatalogRoutes`; `__tests__/helpers/daemon-catalog.ts:25` finds the mount statement by AST. Each Tovu half must update them (lesson 2).
- `tool-catalog.characterization.test.ts` cannot be broken by a daemon source mutation in its spelling, HEAD, OPTIONS and validator rows: they are the framework's answers. Their named break is the mount change, shown above.
- A client that names a validator through `fetch` gets 200 today, not 304: `fetch` adds `Cache-Control: no-cache`. The 304 pin is sent with `node:http`.

## Mutations for `e660edad` (each applied, seen to fail, restored by file copy)

Search loses its same-origin gate (1 test fails); unknown id answers `BAD_REQUEST` (1); default limit 20 (2); max limit 50 (1); entry route mounted before search (17); query trimmed (1); zero limit allowed (1); `describe` given a second argument (4); search returns the thrown text (1).

## Not done (still owed from P0)

- T3 happy-path and parse-failure rows for the other 81 JSON routes (done for the 2 tool-catalog routes only).
- Sorting the 17 `listen` tests into §11.13's three layers.
- §11.15 rows without a harness test (frontend-session wrong owner / wrong bind token, run ownership and owned-list shadowing, principal header rewrite).
- Which element of a repeated query value each route uses.
- R7-G1: not started, see section 4.

## Self-check (owner audits, `tools/owner-audits-2026-11-16`)

`owner-rules-audit.mjs` on Jini: **5 new rows, all `jini-cross-package-import`**, all in `packages/server`: `route-host.ts` imports `@jini-ai/daemon/http` (type), `@jini-ai/http-kit` and `@jini-ai/http-kit/node-bridge`; `feature.ts` and `compose-jini-kernel.ts` each gain one type import of `DaemonRouteHost`. `server` is the host preset that assembles those two packages (run 3's `mount-routes.ts` has the same row); the design puts this code there (§11.9). No other rule has a new row. `args-object-audit.mjs`: no new violation (`presetRouteHost(required, _optional = {})`).

## Verification

- Jini `e660edad` (the last code commit; `e97a4764` adds only the patch file): daemon 4,675 tests pass + 1 pre-existing skip (was 4,647; +28); server 498 pass + 1 skip (was 490; +8); `pnpm guard` ok; `pnpm -r typecheck` 0 errors; `check:size` and `check:complexity` pass. No test deleted or loosened. Baseline before any edit: `pnpm --no-bail -r build` exit 0.
- Tovu `7f898ad5`: `assistant-proxy-routes.test.ts` 33 pass (was 30) on the website runner; `tsc -p tsconfig.json --noEmit` exit 0; `tsc -p tsconfig.tests.json --noEmit` exit 0, 0 errors. No other Tovu test was run. No `apps/desktop` change; the pre-push hook skipped the desktop gates.
- The trial conversion was reverted with `git checkout` of its two files before any gate ran; both trees were clean at each commit.

## Next

1. Owner answers on section 4 (items 1 to 3).
2. Then the `tool-catalog` pair: the trial patch + `http/index.ts`, the preset pack through `mountRoutes` with `context.routeHost`, `tool-catalog.test.ts`, `route-manifest.test.ts`, the T1 literal for that family, API docs; Tovu `agent-daemon-scope.ts:1554`, the two source-reading tests, and the `desktop-agent.ts:377` hunk as a patch.
3. The P0 items under "Not done", one G1 file at a time, each before its own conversion (the tool-catalog file is the model).
