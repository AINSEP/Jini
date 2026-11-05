# totp — ML D1

Scope: `cloud/jobs/COMMON.md`, `cloud/jobs/totp.md`, ML D1 in `cloud/plans/ML-plan-result.md`, and the ML trim, read from fetched `origin/cloud-plans-1105` (`a2e6fe163`). Loaded Software Architect, Programmer and TDD personas from `/workspace/cloud/ai-dev-shop`. Owner accounts only; passkeys, QR libraries, remembered devices and member MFA excluded.

Started November 5, 2026 at 10:48 AM PST; hard deadline 12:48 PM PST. No main push, force push, deployment or publication. All data used in tests is synthetic.

Branches and implementation commits:

- Jini `cloud/totp`, base `6f507852d`: `dfd21ea66018e2ded42a7da71b254a3c8c3e07be`, `6f04eddc7ec50cf1b9eebbd066fbb93746c547ca`, `34f5ada01561d91dde705ec6bb88058333fa8a0a`, `12b49f2a36df2796835181b87cde0df618a6bb0d`. The report commit follows these implementation commits.
- Paired Tovu `cloud/totp`, base `e327c07c8`; its report records its exact commits and push status. Tovu's first storage commit `56909559fd38d9c571c45e58d095f11adf659f37` is pushed. Its later push is awaiting an explicit exception for an unrelated failing desktop pre-push gate.

## Changes

Jini owns the TOTP adapter (`otplib@13.6.0`), injected storage/sealing ports, pending-login transition, enrollment/removal rules and React challenge/settings UI. Tovu owns SQL/HTTP/product composition. Existing token hashing and session creation are reused. The sealer adapter reuses the host's existing AES-GCM capability with authenticated workspace/principal/purpose context; no new key store or cryptography was written.

Enrolled password and launcher sign-in yield a five-minute pending proof and no session/cookie. Proofs are hashed, scoped to purpose/workspace/owner, and limited to five attempts. Failed attempts commit before an error is returned. Successful completion atomically advances the accepted timestep, consumes pending proofs and writes the session. Concurrent completion has one winner. Session-write failures roll back factor/proof changes. Legacy password login refuses enrolled owners and serializes its guard with activation; hosts without MFA retain existing call-order behavior.

Enrollment activates only after verification of the new authenticator. Replacement/removal require a fresh password and the existing factor. Activation/removal revoke existing sessions. Ordinary password reset preserves the factor and invalidates pending proofs. Explicit owner recovery clears factor/pending state together with the password/session/recovery-kit transition. Recovery-kit rotation requires the enrolled factor. UI setup secrets stay in memory and private DOM regions; mutations are sent once, without automatic retries.

## Verification

Commands run from `/workspace/Jini` unless noted:

| Exact command | Result |
| --- | --- |
| `npm --prefix packages/user-management run test -- src/server/__tests__/auth-service.test.ts src/server/__tests__/auth-service.pins.test.ts src/server/__tests__/auth-challenge.test.ts src/server/__tests__/recovery-codes.test.ts` | Unmodified baseline: 96 passed. |
| `npm --prefix packages/user-management run test -- src/server/__tests__/owner-mfa.test.ts src/server/__tests__/auth-service.test.ts src/server/__tests__/auth-service.pins.test.ts src/server/__tests__/recovery-codes.test.ts src/server/__tests__/totp-adapter.test.ts` | Final core: 53 passed, no skipped tests. Includes RFC 6238 vector, expiry, attempts, replay, rollback, owner scope, recovery and legacy-login activation race. |
| `npm --prefix packages/user-management run test -- src/react/auth/__tests__/mfa.unit.test.tsx src/react/auth/__tests__/Login.unit.test.tsx src/react/auth/__tests__/use-login.hooks.unit.test.ts` | 22 passed. |
| `npm --prefix packages/user-management run test -- src/server/__tests__/owner-mfa.test.ts src/react/auth/__tests__/mfa.unit.test.tsx` | After complexity cleanup: 14 passed. |
| `npm --prefix packages/user-management run build` | Passed; TypeScript includes package source/tests and emits declarations. |
| `npm --prefix packages/user-management run typecheck` | Passed. |
| `node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/user-management/src/server/auth-service.ts packages/user-management/src/server/admin-crud-service.ts packages/user-management/src/server/recovery-codes.ts packages/user-management/src/server/mfa/*.ts packages/user-management/src/react/auth/Login.tsx packages/user-management/src/react/auth/TotpSettings.tsx packages/user-management/src/react/auth/hooks/use-login.hooks.ts` | Passed, no errors/warnings. No rules disabled. |
| `node /workspace/work/npm-cache/_npx/ed17c428e728397e/node_modules/pnpm/bin/pnpm.cjs --filter @jini-ai/user-management pack --pack-destination /workspace/work/totp/packs` | Packed JS/declarations include all MFA files and React settings. No publication. |
| `node /workspace/work/totp/packed-consumer/check.mjs` | Extracted-tarball consumer verifies server exports and RFC vector; passed. |
| `git diff --check` | Passed. |

Tovu's SQL tests additionally exercise two real PostgreSQL pools, one-winner completion, same-step replay refusal, rollback after injected session failure and real AES-GCM workspace/principal substitution rejection. See the paired report for exact commands.

Architecture/security review found no remaining verified D1 defect after fixing the legacy-login activation race. Required-object/optional-object service APIs and injected clock/entropy/storage/sealing seams are retained. Tests were written red before bug fixes; no tests, checks or coverage rules were weakened.

## State cost

No background poll/timer was added. At most one pending row per owner/purpose (login/enroll), each normally below 1 KiB; replacement bounds growth. Factor rows contain only a sealed secret and last timestep.

A configured sign-in has four bounded identity/factor reads; enrolled sign-in writes one pending row. Completion uses four bounded reads and five writes including the existing session and last-login writes (three added proof/factor writes). Enrollment/removal are explicit actions; revocation uses the existing owner-session enumeration, O(s) time/space for s sessions. Settings/status reads occur once per mount. Confirmation/removal add one session-status read to trigger the existing sign-out listener. No new telemetry payload, queue or table beyond the two planned MFA tables.

## Environment and open limits

`/workspace/shared/dev-env.sh` and `/workspace/shared/start-postgres.sh` do not exist. Node 24.22.1 is installed. The system pnpm is 11; package operations used pnpm 10.33.2 in workspace scratch. The full setup build (`npm_config_cache=/workspace/work/npm-cache npx --offline pnpm@10.33.2 -r --if-present run build`) stops in unchanged provider-plugins because its installed dependency links are incomplete (jsdom initially, then React/chart packages). Affected user-management and downstream packages were built separately. Tovu was relinked with `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` after Jini changes.

Tovu server/desktop typecheck has a pre-existing deployment typing failure, reproduced on the untouched base. Admin typecheck also retains two pre-existing test typing errors; new MFA typing passes. No full application suite was requested/run; the desktop push hook independently invoked its broader gates, then was stopped after its known baseline typecheck failure. Its coverage gate did not complete. No bypass has been used without user approval.

Unrelated untracked `packages/plugin-ui-ux-design/` pre-existed and was left untouched. Local compiled artifacts and synthetic test scratch remain ignored under the workspace.

BUG FIXED: Pending first-factor proofs could otherwise survive ordinary password reset; reset now clears proofs and preserves the enrolled factor.
BUG FIXED: Legacy `login()` guard/mint could race first MFA activation; a barrier regression verifies serialization and revocation.
BUG FIXED: SQL factor output could inherit extra caller fields; it now returns explicit persisted scope only.
BUG OPEN: Tovu base `apps/website/src/features/deployments/publish-credentials/store.ts:410` passes `string | undefined` to a required string.
BUG OPEN: Tovu base admin `api-user-facing-fallback.unit.test.ts:24-25` treats a caught value of type unknown as an Error.
LIMIT: Desktop bootstrap discards a pending boot response and shows the normal password-plus-TOTP form; no pre-factor session is granted, and labelled launcher recovery remains available.
