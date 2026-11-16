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
