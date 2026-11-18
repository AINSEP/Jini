# C6 continuation (wave 2): the HTTP sub-ports, so sheet C6 is complete (Jini side)

Unattended run, 2026-11-17. Branch `wave2/c6-cont` in Jini and Tovu, from `origin/refactor/terra` (Jini `65d73b0d`, Tovu `232764af`).
Design: `sheets/C6.md` §4, §4d, §4e (+ the daemon INDEX / R7 / R8 pairings). First run's report: `cloud-results/c6.md`.
Node 24.11.1, pnpm 10.33.2. Setup: `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` (exit 0, before any edit).

**Result: C6 COMPLETE.** Everything the sheet assigns to C6 is on the base now. What was left after the first run was the two HTTP
sub-ports (§4) and the stale docs. The Tovu desktop hunk was already applied on `refactor/terra` (checked: `desktop-agent.ts:285-286`
read `runtime.codex.disablePlugins` / `runtime.pi.gracefulShutdownMs`; all four desktop tsconfigs typecheck against this branch).

## Commits (Jini `wave2/c6-cont`)

| SHA | Content |
|---|---|
| `682dd95c` | `daemon/src/ports/provider-http.ts` (`ProviderToolTurnPort` + `PinnedFetch*` restated byte for byte from `connection-guard.ts:182-211`, §4d) and `daemon/src/ports/xai-oauth.ts` (`XaiOAuthPort` + the restated OAuth types, §4); subpaths `./ports/provider-http`, `./ports/xai-oauth` (exports + `jini.entries`, node); DI fakes `fakeProviderToolTurnPort`, `fakeBaseUrlGuard`, `fakeXaiOAuthPort` with 7 self-check tests; `satisfies` proof in `server/src/__tests__/runtime-port-bindings.typecheck.ts` |
| `2ad4753a` | agent-runtime `docs/spec/api.spec.md`: the export table lists only what the root exports (a script compared every backticked name with the root's real exports: 0 names listed that are not exported); new "Vocabulary that moved to core" table; the C6 additions documented (`createAgentRuntimeBindings`, `bindRuntimeAgentDef`, Codex/Pi def options) |
| `021575a6` | core README rows for `./contracts/agents` and `./contracts/ai-trace`; daemon README paragraph on the runtime ports |

## Test first, and what each pin catches

- `provider-http-ports.fake.test.ts` (7 cases) written first. Red: hiding the fake gives `Failed to load url ./provider-http-ports.fake.js` (1 file failed). Green after: 7/7.
  (My first "red" was a vitest flag error, `options.minThreads and options.maxThreads must not conflict`; I re-proved red the honest way. vitest here needs `--maxWorkers=2 --minWorkers=1`.)
- Type-level proof, no cast: `ProviderToolTurnPort` is satisfied by the five real `run<Provider>ToolTurn` functions passed directly; `XaiOAuthPort<PendingAuthCache>` by lambdas over the real OAuth functions.
  Mutations, each applied, `tsc -p server` run, reverted (baseline 0 errors; restored 0):

| Mutation | `tsc` errors |
|---|---|
| anthropic required `maxTokens` renamed `maxTokenz` | 1 |
| google required `contents` renamed `messages` | 1 |
| `tokens.get` returns `Promise<string \| null>` | 1 |
| `redirect.port: string` | 1 |

## Decisions inside the sheet's room (each needed a call; none is a cast or a redesign)

1. **`XaiOAuthPort` is generic in the pending cache** (`XaiOAuthPort<Pending = OAuthPendingAuthorizations>`). A first non-generic version failed the real proof: `beginOAuthPkce` takes the concrete `PendingAuthCache` class (it calls `put`), and an interface without `put` is not assignable to it. `begin`/`complete`/`createPendingCache` now share one `Pending` type: the host states `XaiOAuthPort<PendingAuthCache>` and the check is exact; the daemon uses the default (it only calls `consume`).
2. **`ProviderToolTurnPort` is deliberately loose** (sheet §4: `messages: readonly unknown[]`, events as `{ type }`, `executeTool?(call: unknown)`), declared with method syntax, so the check against the typed runners is bivariant: it proves argument names, the required/optional split and the result shape, not the vendor wire payload (vendor types stay out of core). Said so in the file header. The five results are not uniform in the runners (`stopReason` for Anthropic, `finishReason` for the others), so there are two result types.
3. Placed in `ports/provider-http.ts` and `ports/xai-oauth.ts` (§4d names `provider-http.ts`; xAI types are single-consumer, §4). `BaseUrlGuardPort` stays in `ports/agent-runtime.ts` where the first run put it.
4. The fakes use no `vi.mock`; `fakeXaiOAuthPort` keeps pending states in a `WeakMap` keyed by the cache object, so `begin` fills the cache `createPendingCache` made without a cast.

## Gates (exact commands, all in `/home/user/Jini` unless a package is named)

- `npx vitest run --maxWorkers=2 --minWorkers=1` in `packages/daemon`: 236 files passed, 1 skipped; 4729 passed, 1 skipped. Includes the 3 files of `src/ports/__tests__` (18 tests).
- same in `packages/server`: 32 files, 505 passed, 1 skipped.
- `pnpm -r typecheck`: exit 0, 0 `error TS`.
- `pnpm guard`: ok, 0 violations after one fix (a comment named a consumer; `N1-consumer-identity` caught it; reworded).
- `pnpm check:size`: "Size ratchet passed: 157 debt entries (133 functions, 24 files); 8 accepted exceptions." `pnpm check:complexity`: "Complexity ratchet passed: 17 entries (3 cyclomatic, 14 cognitive)."
- BASE-RED ratchets (files this run did not touch; the lines are in `packages/ui`, `packages/http-kit`): `pnpm check:hooks` fails on `packages/ui/.../AssetGridToolbar.tsx:49`; `pnpm check:log-safety` fails on `packages/http-kit/src/node-bridge.ts`; `pnpm check:errors` (WARN mode) prints 18 new-or-worse entries, e.g. `packages/ui/src/react/hooks/usePersistedDisclosure.ts`. None is in a file of this diff; no new line was added by this run.
- Not run: the full `pnpm -r test` in one pass (daemon and server run per package; core/agent-runtime/chat have no source change, only docs); provider-plugins and analytics tests.

## Not done, and why (none of it is C6)

- **R8b step 6:** the launcher consuming `AgentRuntimePort`, then deleting the executor's `codexDisablePlugins` / `piGracefulShutdownMs` / `runtimeState` and the host lines. R8b is the lane C6 unblocks.
- **R7:** threads `ProviderToolTurnPort`, `XaiOAuthPort` and `BaseUrlGuardPort` into the route deps as required fields, repoints `model-proxy.ts` / `xai.ts` / `research-tavily.adapter.ts` off agent-runtime, and uses the fakes. F1 (xAI routes leave daemon) removes `XaiOAuthPort` afterwards.
- **R4:** threads `ChatAgentPolicyPort` / `chatAgentFailures` into chat.
- Not refreshed: the understand-anything and graphify indexes (the moved files are stale in them).
- First run's deviation 7 (inline `import()` type queries in two files that sit exactly on their size record) is unchanged; fixing it needs a size-debt edit, which is not mine.

Overlaps with other runs: Jini `packages/daemon/package.json` (one export block, adjacent to R8a's `./ports/*` lines) and `packages/server/src/__tests__/runtime-port-bindings.typecheck.ts`; docs under `packages/{core,daemon,agent-runtime}`. Expect a trivial rebase conflict in `daemon/package.json` if R8a also adds a `./ports/*` entry.
