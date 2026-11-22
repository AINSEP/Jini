DONE 9ebfc5eac

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
| P10 | status fields | `envVarName`, `reason` dropped by the projection | kept when present (blank `envVarName` dropped) | kept | `AdminSiteKeyStatus.envVarName?`, `reason?` |

W15 (reveal) is out of scope (SEC-6). The status projection is still explicit: `hex`, `token`, `siteKey` and any other extra are dropped (pinned by a test).

## Files
- `packages/admin/src/security/models.ts`: `RootKeyStatus` gains `envVarName?: string` and `reason?: 'empty' | 'not-hex' | 'odd-length' | 'too-short'` (why-comments added).
- `packages/admin/src/security/adapters/http.ts`: `createHttpRootKey({ transport, workspacePath }, { path = '/system/site-token', importField = 'token' } = {})`; import body is `{ [importField]: token }`; status projection moved to a private `rootKeyStatus()` helper (keeps complexity ≤ 10), which adds the two fields.
- `packages/admin/src/security/adapters/memory.ts`: no change needed. It already stores the supplied `RootKeyStatus` whole, so it accepts the new fields; a test pins this.
- `packages/admin/src/security/__tests__/http.test.ts`: +6 tests (SEC-4 describe, ported from Tovu `hooks/__tests__/site-key-dependencies.unit.test.ts`, minus reveal; asserts method, path and `JSON.stringify(body)`).
- `packages/admin/src/security/__tests__/memory.test.ts`: +1 test.
- `.changeset/p9-sec-4.md` (`@jini-ai/admin`: minor).
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
- `createMemoryRootKey` keeps `invalid` and `reason` on a status after it activates. That was already true of `invalid` before this step. SEC-5 may want to clear both on activation.
- No secret values are logged or displayed. The new tests assert that no key material leaks through the status projection.
