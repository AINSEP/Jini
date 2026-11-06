# passkeys — complete

Job instructions: `cloud/jobs/COMMON.md`, `cloud/jobs/passkeys.md`, `cloud/plans/ML-plan-result.md` D2 and TRIM “ML”, read from fetched Jini `origin/cloud-plans-1105`. Loaded Software Architect, Programmer and TDD personas from `/workspace/cloud/ai-dev-shop`.

Started November 5, 2026 at 4:02 PM PST; hard deadline 6:02 PM PST. Both branches are `cloud/passkeys`, cut from the current `origin/cloud/combine` tips: Jini `3a86f98ba03380651c8bf64b8fc18c4f90a122fd`; Tovu `abead52498c80fd86b8f7b37a2caed31d98a7307`. No main/combined-branch push, force push, deployment or npm publication. Test data is synthetic.

## Delivered behavior and boundaries

Owner-only passkeys are an alternative second factor after password verification. Registration/removal require current owner password plus confirmed TOTP; TOTP and recovery remain the fallback. No passwordless discovery, member MFA, remembered devices or dashboard. Registration supports at most five credentials.

Jini owns ceremony decisions, ports, the SimpleWebAuthn adapter and reusable React controls. Tovu supplies SQL, trusted site/listener origin, HTTP admission and component mounting. Challenges reuse the existing MFA pending store, are sealed and bound to owner/workspace/purpose/origin/RP, expire after five minutes, and are single-use. Password and TOTP/passkey completion share the same identity transaction. Concurrent TOTP/passkey completion has one winner. Counter updates, challenge consumption, session creation and last-login timestamp roll back together.

User verification is required. SimpleWebAuthn verifies signatures, RP IDs, origins and counters, including legitimate zero counters. Only public keys, credential IDs, counters and RP IDs persist. No private keys persist. Request Host/Origin/forwarding headers never select the trusted origin. Local origin includes the actual listener port; RP ID remains the hostname across port changes. Browser support/cancellation errors retain authenticator/recovery fallback. Browser adapter loads only on an explicit passkey action; mutations use single-send requests.

One additive ADR-066 migration (`0041_owner_passkeys`) is registered in the TS history, pinned checksums, fresh SQLite bootstrap, generated schema/types and PostgreSQL head pins. Recovery and TOTP removal clear passkeys with factor/pending state. Ordinary password reset preserves enrolled factors/credentials and clears all password-created pending proofs. No timers or background polls.

## Dependency download measurement, before adoption

Registry tarball bytes, SHA-512 integrity checked for all 26 unique artifacts:

| Artifact | Direct compressed download | Including transitives |
| --- | ---: | ---: |
| `@simplewebauthn/server@14.0.3` | 121,672 B | 546,496 B |
| `@simplewebauthn/browser@14.0.0` | 42,879 B | 42,879 B |
| Combined | 164,551 B | 589,375 B |

Published browser full minified UMD: 13,473 B / 3,806 B gzip (level 9, deterministic timestamp); actual application tree-shaking can differ. Measured using isolated `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, tarball downloads/integrity verification and `gzip.compress(..., compresslevel=9, mtime=0)`. Evidence: `/workspace/work/passkeys-size/{measure.py,package-lock.json,download-sizes.json,browser-bundle-size.json}`. No vendor code was copied into core.

## Prerequisite gap found on the approved base

The base contained Jini TOTP services and Tovu MFA tables but did not bind Tovu MFA storage into password/boot login, management, reset or UI. An enrolled owner could receive a normal launcher/password session before a factor. This was a real prerequisite bypass, so this job supplies the missing thin host wiring. The new launcher regression fails on detached unmodified Tovu base `abead5249` and passes here. Reused Jini `beginOwnerLogin`, `beginPrincipalSignIn`, `completeOwnerLogin`, `TotpSettings` and `useLogin`; no second authentication framework.

## Review, integrity and cost

Architecture review: PASS for this change. Protocol crypto lives only in the Jini adapter; Tovu adds no protocol implementation. Public service/factory boundaries use required-object plus optional-object arguments. Existing identity locking, tokens, sessions, owner policy, sealing and admin diagnostic reporting are reused. Unexpected route faults go through existing redacted incident reporting; assertions, factors and codes are never logged. All new feature functions and changed authentication handlers pass complexity and cognitive-complexity ceiling 10, without disabling rules. Existing large composition functions retain the baseline violations listed below; their complexity did not increase.

Function review: ceremony/state service PASS (bounded O(n), n <= 5); library adapter PASS (bounded protocol input); browser/UI PASS (explicit action, cancellation guard, no polling); repository PASS (indexed queries, list capped at six rows for cap detection); transport PASS (trusted scope and 16 KiB registration / 8 KiB assertion limits). Adversarial evidence covers duplicate credential IDs/counter reset, cross-factor competition, concurrent proof reuse, wrong scope/purpose/origin/RP, missing UV, bad signatures, counter replay, expiry, replaced password proofs and persistence failure. A late browser response after cancelling MFA is discarded. Tests and checks were never skipped, disabled, weakened or deleted.

State cost, excluding existing identity transaction/lock overhead and host keyring lookups: enrollment begin <=5 fixed domain reads +2 writes; enrollment finish 3 reads +2 writes. Passkey-login begin adds 2 reads +1 pending write after the existing password transition. Successful finish uses 5 fixed reads +5 writes including existing session/last-login writes; one bounded credential list contains <=5 normal rows. Settings status is one credential-list read per mount/explicit refresh. Explicit recovery/TOTP removal adds one credential DELETE. No added poll/timer. Pending challenge envelopes are normally <1 KiB; credential public-key rows are bounded protocol material. Existing factor changes revoke O(s) owner sessions.

BUG FIXED: Base Tovu password/launcher login could bypass enrolled-owner MFA because its store was unbound.
BUG FIXED: Duplicate credential registration could reset an existing counter; server now rejects re-registration independently of browser exclusion hints (red test before fix).
BUG FIXED: Cancelling the MFA screen while a browser prompt was open could submit its late response; generation guard now discards it (red test before fix).
BUG FIXED: Passkey success omitted the existing last-login timestamp; it now updates atomically (red test before fix).
BUG FIXED: DOMException cancellation need not satisfy `instanceof Error`; name-based cancellation detection preserves the actionable fallback (red test before fix).

BUG OPEN (baseline): Four existing boot tests expect anonymous `details.failure` that the base's shared failure mapper deliberately strips: missing owner; disabled owner; member owner; minted session that Jini cannot validate. All four reproduce unchanged on detached base; assertions remain unchanged. Baseline evidence: `/workspace/work/passkeys-size/baseline-existing-boot-failures.log`.
LIMIT: Launcher pending MFA currently falls back to the normal Login screen and password re-entry, without granting a session. Packaged Electron WebAuthn compatibility remains a separate release check.
LIMIT: This is a paired-source delivery. A coordinated Jini release/adoption is still required for registry-only Tovu builds; publication/version adoption is outside this job. The normal release build correctly refuses local links; supported `build:local` validates this paired checkout.
MINOR FINDINGS: Tovu Login has two nested-ternary Sonar warnings; MFA/passkey SQL adapters have four nested-callback warnings; the pre-existing recovery failure mapper has one nested-ternary warning. No feature complexity ceiling failures remain. Large composition-root violations are unchanged from detached baseline: `createRouteDeps` 11; `createApp` 11; `composeSiteRouteDeps` 18 cyclomatic / 18 cognitive. No broad refactor was made.

## Verification (Node 24.22.1)

Commands below run from `/workspace/Jini` after `source /workspace/.tovu-build/env.sh`.

| Exact command | Result |
| --- | --- |
| `CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store` then `pnpm -r build` | Passed. Full build requested for setup, no full test suite. Initial default-store install hit a read-only cache; writable store resolved it. |
| `npm --prefix packages/user-management run build` | Passed, including JS/declaration emission. |
| `npm --prefix packages/user-management run typecheck` | Passed. |
| `npm --prefix packages/user-management run test -- src/server/__tests__/owner-passkeys.test.ts src/server/__tests__/owner-mfa.test.ts src/server/__tests__/auth-service.test.ts src/server/__tests__/auth-service.pins.test.ts src/server/__tests__/recovery-codes.test.ts src/react/auth/__tests__/passkeys.unit.test.tsx src/react/auth/__tests__/passkey-browser.unit.test.ts src/react/auth/__tests__/mfa.unit.test.tsx src/react/auth/__tests__/Login.unit.test.tsx src/react/auth/__tests__/use-login.hooks.unit.test.ts` | 94 passed across 10 affected files. |
| `node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/user-management/src/server/mfa/*.ts packages/user-management/src/react/auth/Passkeys.tsx packages/user-management/src/react/auth/passkey-browser.ts packages/user-management/src/react/auth/hooks/use-login.hooks.ts` | Passed, no warnings/errors. |
| `pnpm --filter @jini-ai/user-management pack --pack-destination /workspace/work/passkeys/packs` | Passed. No publication. |
| `npm_config_cache=/workspace/work/npm-cache npm --prefix /workspace/work/passkeys/packed-consumer install --ignore-scripts --no-audit --no-fund` then `node /workspace/work/passkeys/packed-consumer/check.mjs` | Passed against isolated tarball install with registry dependencies: server exports, real option generation/required UV, React artifacts, lazy browser import. |
| `git diff --check` | Passed. |

Paired Tovu report has exact SQL/HTTP/Chromium commands and results, including two independent real PostgreSQL pools and actual browser no-cookie-before-factor verification. Test regressions were run red before their fixes. Routine logs: `/workspace/work/passkeys/`. Coverage percentages were not used as a gate; direct security/state outcomes are asserted. Full application suites were left to the later coordinated run as instructed.

## Function-quality disposition

| Unit | Disposition | Evidence / remaining finding |
| --- | --- | --- |
| Enrollment/login state service | PASS | Single-use and scope guards; high-priority counter-reset bug fixed; atomic login timestamp fixed. |
| WebAuthn adapter | PASS | Library owns crypto, required UV and counters; real Chromium negative cases pass. |
| Browser/UI actions | PASS | Late-cancellation and DOMException bugs fixed; no retained setup proof after cancel; no poll. |
| SQL adapter | PASS | Indexed, bounded queries; ownership/rollback/race tests pass; minor callback style warnings remain. |
| Host admission/configuration | PASS | Trusted origin/port, owner-only management and payload/rate limits; baseline composition complexity listed separately. |

Pre-completion review rechecked the active D2 scope, emitted package exports, actual HTTP/browser no-cookie-before-factor path and test integrity. Runtime self-validation PASS on synthetic HTTP/SQL/Chromium fixtures; packaged Electron remains an explicit release limit. No source changes remain outside the job/prerequisite boundary. No coverage percentage was claimed; security outcomes are directly asserted. Full suites remain deferred per the job.

## Commit inventory

Jini `cloud/passkeys`:

- `bd85337d7c486b5339c7cfc5920bce50645a14c1` — docs(passkeys): record scope, base and dependency measurements
- `8fe9899948053ba77f75b2c0365f9d0685f9efd6` — feat(identity): add owner passkey ceremonies behind MFA ports
- `e958d835a73fe78781b65cf3cc788a0cbbf458dc` — feat(identity): add lazy browser passkey controls and cancellation guards
- `168eb3adfb0eca9a0e2eb831bc490476ed1faac6` — fix(identity): preserve login metadata and browser cancellation errors

Tovu `cloud/passkeys`:

- `7f97eb6f051cf9dfd104e09c92c77334248ca8d6` — feat(identity): bind owner MFA to password and launcher sign-in
- `220570778a9cef7c7c54c92c8ee814d88c032418` — feat(identity): persist scoped public passkey credentials
- `883846c4a23f1cb9d5f8e9e66cfab4387a21ba97` — feat(identity): wire owner authenticator settings and pending login UI
- `457d8848ea50699a9fa9c1f0cd88b80527d5cc4c` — test(identity): verify pending owner login and MFA admission
- `e7b0ca29d53f6389c7456e0070cb277b8c1bc567` — fix(identity): pass factor proof when rotating owner recovery codes
- `d413b27d91591472ef4ffd263dd99a4ff785cf44` — test(identity): reject pending TOTP and passkey proofs after password reset
- `7f3f4390de60bf18f49baea5a7f84ae711bbc645` — feat(identity): wire passkey routes and owner UI with trusted origins
- `fa553c37950587c9504b7c7589adf6d92099384a` — test(identity): verify passkey races and recovery on real PostgreSQL
- `c4c1c248d1020bb0517cb418f7d2e34ca2c5cbb5` — test(identity): exercise passkeys through real HTTP and Chromium
- `945e7faac3d47195e55492522c2146450b3dca49` — fix(identity): keep MFA host changes within the complexity budget

Final report commits follow this implementation inventory. Pushes use pull/rebase first and never force.
