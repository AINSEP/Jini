DONE 2113fdd6e

# SEC-4 — Root-key wire parity (Jini, branch `codex/sec4-jini`)

Base: `origin/integ/merge-14-2026-11-22` (4902a6a1a). Spec: Tovu `plan/whats-left-1122` `plans/P9-SEC-plan.md` §SEC-4 (P10, P11, W14, W16–W18) plus the `P9-SEC-check.md` correction ("retain the Jini defaults"). Tovu source of truth: `apps/admin/src/features/sites/api/sites-api.ts:59-90` and `sites-api.types.ts:132-146` at `integ/merge-13-2026-11-22`.

## Commits (all pushed to `origin/codex/sec4-jini`)
- `cd89ce6cc` test: failing SEC-4 wire-parity tests (red: 4 failed / 28 passed in http.test.ts)
- `606155c16` feat: `createHttpRootKey` wire options, `RootKeyStatus.envVarName/reason`, changeset
- `9ebfc5eac` chore(api): admin baseline update
- this report commit (the SHA on the first line is the commit before it)

## Wire table (paths under the host's `workspacePath`, e.g. `/api/admin/v1/workspaces/workspace-local`)

| # | Call | Before (stock Jini, the only option) | After, default (unchanged) | After, Tovu options `{ path: '/system/site-key', importField: 'siteKey' }` | Tovu |
|---|---|---|---|---|---|
| W14 | status | `GET /system/site-token` | same | `GET /system/site-key` | same |
| W16 | generate | `POST /system/site-token/generate` (no body) | same | `POST /system/site-key/generate` (no body) | same |
| W17 | import | `POST /system/site-token/import` `{"token":…}` | same | `POST /system/site-key/import` `{"siteKey":…}` (value sent verbatim, untrimmed) | same |
| W18 | preview | `GET /system/site-token/start-fresh` | same | `GET /system/site-key/start-fresh` | same |
| W18 | start fresh | `POST /system/site-token/start-fresh` `{"confirm":…}` | same | `POST /system/site-key/start-fresh` `{"confirm":"START FRESH"}` | same |
| P10 | status fields | `envVarName`, `reason` dropped by the projection | kept when present (an empty `envVarName` is kept too; see Review fixes) | kept | `AdminSiteKeyStatus.envVarName?`, `reason?` |

W15 (reveal) is out of scope (SEC-6). The status projection is still explicit: `hex`, `token`, `siteKey` and any other extra are dropped (pinned by a test).

## Files
- `packages/admin/src/security/models.ts`: `RootKeyStatus` gains `envVarName?: string` and `reason?: 'empty' | 'not-hex' | 'odd-length' | 'too-short'` (why-comments added).
- `packages/admin/src/security/adapters/http.ts`: `createHttpRootKey({ transport, workspacePath }, { path = '/system/site-token', importField = 'token' } = {})`; import body is `{ [importField]: token }`; status projection moved to a private `rootKeyStatus()` helper (keeps complexity ≤ 10), which adds the two fields.
- `packages/admin/src/security/adapters/memory.ts`: stores the supplied `RootKeyStatus` whole, so it accepts the new fields (a test pins this). Since the review fixes, a successful activation rebuilds the status and drops `envVarName`, `invalid` and `reason`.
- `packages/admin/src/security/__tests__/http.test.ts`: +6 tests (SEC-4 describe, ported from Tovu `hooks/__tests__/site-key-dependencies.unit.test.ts`, minus reveal; asserts method, path and `JSON.stringify(body)`).
- `packages/admin/src/security/__tests__/memory.test.ts`: +1 test.
- `.changeset/p9-sec-4.md` (`@jini-ai/admin`: patch, per the P9 §1 patch rule that P9-SEC §1b inherits; was minor before the review fixes).
- `api-baseline/jini-ai__admin.json`.

## Exports and baseline delta (`pnpm api:update`)
- changed `./security#RootKeyStatus` interface:ed7f755a33 → interface:89585e8ffc (additive optional fields)
- changed `./security/adapters/http#createHttpRootKey` function:e32f9988f0 → function:e54763a775 (additive optional second arg, replacing the `_optional = {}` pad)
- No added or removed exports. `pnpm api:check` passes (40 packages, 695 entries, 17245 symbols).

## Tests
- Red first (`cd89ce6cc`): 4 failed (Tovu paths/bodies, configured import field only, envVarName/reason kept, refusal-then-retry on the Tovu path); 28 passed.
- Green: `npm --prefix packages/admin run test` → 252 files, **3094 tests passed** (baseline 3087 + 7 new; none removed or weakened).

## Mutation (plan-named)
Hardcode `{ token }` in `importToken` → red:
```
× SEC-4 … sends exact Tovu paths, methods and serialized bodies, and returns the literal replies
× SEC-4 … sends only the configured import field, never the default one beside it
× SEC-4 … propagates an import refusal unchanged, then permits a retry
Tests  3 failed | 29 passed (32)
```
Restored with `git checkout` → `Tests 32 passed (32)`, clean tree.

## Gates
- `pnpm install --frozen-lockfile`: ok. `pnpm -r build`: EXIT 0.
- `pnpm typecheck` (whole repo): EXIT 0.
- `pnpm guard`: ok.
- `pnpm api:check`: ok after update (before the update it showed only the two admin entries above).
- `check:size` / `check:complexity`: both fail at base and head with the **same** set (diff empty). Pre-existing reds: complexity `agent-runtime/…/session-results.ts handleRpcError`, `chat/…/event-projection.ts readConfirmationResume`, `core/src/errors/reporter.ts refusalError`, `ui/…/ErrorNotice.tsx`; size `cms/src/redirects/redirects.ts` (513 lines). **No new red.**
- `check:hooks`: ok. `check:why-comments --base merge-14`: ok, 0 blocks lost.
- `check:cross-package`: no XP1/XP2/XP4/XP5 entries for changed files. XP3 cannot be evaluated here because it needs a `JINI_DECLARATION_BASELINE_DIR` snapshot built from a clean checkout at 35c4961af. Every one of the 2052 XP3 lines is that same environment error, at both base and head. The diff adds no import statements, so there is no new cross-package declaration edge.
- `check:log-safety`: fails with 10 pre-existing entries, none in `packages/admin` (chat, core, daemon, desktop-host, http-kit, ui). **No new red.**

## Notes for SEC-T1 and Codex
- Tovu's host composes `createHttpRootKey({ transport, workspacePath: '/api/admin/v1/workspaces/<ws>' }, { path: '/system/site-key', importField: 'siteKey' })`. Server-side authorization (`admin.security.site-key.manage`, the real-session and workspace checks) is untouched: this step is client wire only.
- `createMemoryRootKey` now clears `envVarName`, `invalid` and `reason` when it activates (review FIX 2), so SEC-5 does not need to.
- No secret values are logged or displayed. The new tests assert that no key material leaks through the status projection.

## Review fixes

Review: Tovu `origin/plan/whats-left-1122:reviews/ex5b-review-sec4-rereview.md`, section `codex/sec4-jini` (`22b390df2`), FIX 1-4. Nothing else changed.

### Commits (pushed to `origin/codex/sec4-jini`)
- `a95b71f06` test: review-fix tests first (red: 2 failed / 75 passed in `http.test.ts` + `memory.test.ts`; the §1b secrecy regression passed at once because it pins behavior the controller already had)
- `2113fdd6e` fix: FIX 1, 2 and 4
- this report commit (the SHA on the first line is the commit before it)

### Fixes
1. `packages/admin/src/security/adapters/http.ts` `rootKeyStatus()`: `r.envVarName !== undefined` replaces the truthiness check. `http.test.ts` "projects status explicitly…" now expects `envVarName: ''` and still asserts that `hex`/`token`/`siteKey`/`extra` are dropped. A new test pins that an absent `envVarName` stays absent.
2. `packages/admin/src/security/adapters/memory.ts` `activate()`: builds the active status from `keyFilePath` and `runtimeMode` only, and no longer spreads the previous status. `envVarName`, `invalid` and `reason` from an env-sourced refusal are not carried over (why-comment added). New `memory.test.ts` test: a successful import from a seeded `source: 'env'`, `invalid: true`, `envVarName`, `reason: 'odd-length'` status yields exactly `{ active: true, source: 'file', state: 'active', keyFilePath, runtimeMode, fingerprint }`.
3. `http.test.ts` new P9-SEC §1b test. It runs `createHttpRootKey` on the Tovu wire through `createRootKeyController`. A fixture 64-hex key is echoed in the transport refusal (error message and `body.siteKey`), in the status reply (`siteKey`), in the retry's success reply, and in the post-unlock status (`hex`). The refused import returns `false` with the fixed message. The state, apart from the operator's own `token` field, excludes the key. The retry succeeds and the whole snapshot (status, result, error, token) excludes the key. `console.log/info/warn/error/debug` are spied, and none of their calls contains the key. The existing "propagates an import refusal unchanged" test (adapter keeps the typed refusal) is unchanged.
4. `.changeset/p9-sec-4.md`: `@jini-ai/admin` `minor` → `patch`. This report's Files section is updated to match.

### Mutations (each restored with `git checkout`, clean tree afterwards)
- Truthiness check restored (`r.envVarName ?`): red, 1 failed (`projects status explicitly…`), 250 passed.
- Stale `envVarName` carried into the active memory status: red, 1 failed (`drops envVarName, invalid and reason…`), 250 passed.
- Key echoed. (a) The controller shows `String(e)` as the error: red, 4 failed, including the §1b test. (b) The controller calls `console.error(e)` on refusal: red, 1 failed (the §1b test). (c) The status projection spreads the raw reply: red, 4 failed, including the §1b test.

### Gates
- `pnpm install --frozen-lockfile`: ok. `pnpm --filter "@jini-ai/admin..." build` and `pnpm --filter "...@jini-ai/admin" build`: EXIT 0. `pnpm -r build`: EXIT 0. A full build is required before `api:check`/`typecheck`; with only admin's graph built, `api:check` reports phantom REMOVED exports for unbuilt packages.
- `pnpm typecheck`: EXIT 0. `pnpm guard`: ok. `pnpm api:check`: ok (40 packages, 695 entries, 17245 symbols). The fixes change no signatures, so the baseline is unchanged.
- `check:hooks`: ok. `check:why-comments --base origin/integ/merge-14-2026-11-22`: ok, 0 blocks lost.
- `check:size`, `check:complexity`, `check:log-safety` and `check:cross-package` exit 1, but no changed file appears in any of their output. Complexity shows the same four pre-existing reds listed above. Size shows `cms/…/redirects.ts`, `daemon/…/launch.ts` (worsened 950→952 / 416→418) and stale `sidecar/json-ipc.ts` entries, all in files this branch does not touch. Log-safety has 10 entries, none in `packages/admin`. Cross-package for changed files shows only the XP3 `JINI_DECLARATION_BASELINE_DIR` environment error noted above, so XP3 is still unverified. **No new red.** The base was not re-run in this pass; the "no new red" claim rests on no changed file appearing in any failure.
- `npm --prefix packages/admin run test`: 252 files, **3097 passed** (3094 before + 3 new; none removed or weakened).
- No secret value was logged or displayed. The fixture key is a test constant (`'0123456789abcdef'.repeat(4)`).

