Software Architect(Direct): Loaded and applied the Software Architect, Programmer, and TDD skills. Read-only inspection completed; no files changed and no tests, installs, builds, servers, or localhost requests run.

**1. Goal**

Finish durable form-notification email as A, then ship opt-in TOTP and passkeys as D, reusing existing Jini services and keeping C parked.

**2. Findings**

- **Recovery/reset exists in source, but “shipped” is not confirmed.** Jini implements ten hashed codes, atomic redemption/reset, session revocation, and kit invalidation: [recovery-codes.ts:50](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/user-management/src/server/recovery-codes.ts:50). Tovu has the [routes](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/owner-recovery-routes.ts:104), [hidden-input CLI](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/cli/commands/reset-owner.ts:12), and [migration registration](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/platform/db/migrations/index.ts:114).
- **Package adoption is behind source.** Tovu locks user-management/CMS/platform at 0.6.19; Jini source is 0.6.22. Installed user-management lacks the recovery exports present in source. Evidence: [lockfile:3562](/Users/la/Programming/tovu-integration-clones/prov2-tovu/package-lock.json:3562), [installed exports:1](/Users/la/Programming/tovu-integration-clones/prov2-tovu/node_modules/@jini-ai/user-management/dist/server/index.d.ts:1), [source exports:27](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/user-management/src/server/index.ts:27). A cloud build must resolve this first.
- **A is substantially implemented in Jini source.** Notifications already enqueue stable, reference-only recipient jobs; failures propagate to the existing outbox. Tovu wires that outbox and selects the existing delivery retry policy. Reuse these: [subscriber:62](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/notify-subscriber.ts:62), [wiring:1843](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/app.ts:1843), [retry policy:23](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/contracts/core/events/outbox-retry-policies.ts:23).
- **Readiness is already enabled for forms**, although installed CMS still exposes its older inline subscriber. Do not treat the flag as delivery proof: [readiness:2](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/forms/mail-outbox-readiness.ts:2), [installed subscriber:22](/Users/la/Programming/tovu-integration-clones/prov2-tovu/node_modules/@jini-ai/cms/dist/forms/notify-subscriber.d.ts:22).
- **Small A gaps remain:** the notification result contract/error conversion loses `retryAfterMs` and uncertainty information. Existing `FormDeliveryError` already supports both; reuse it. [Forms contract:67](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/ports.ts:67), [conversion:148](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/notify-subscriber.ts:148), [existing error:38](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/delivery/errors.ts:38).
- **D is absent from inspected identity paths.** Password login immediately creates a full session. Adding a code field to the screen would leave a bypass. [auth-service.ts:135](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/user-management/src/server/auth-service.ts:135).
- Checked reusable mechanisms: Jini challenge expiry/attempt/consumption contracts, identity transactions, session minting, secret sealing, recovery codes; Tovu outbox leases, mail ledger, suppression, status counts, and existing login/security screens. No new authentication framework is needed.
- Applied the 10-24 decisions: localhost first, provider-swappable mail, no hosted relay, no password-minimum increase. Architecture chapters 13/14 and project memory were missing from the clone paths; I consulted the originals supplied under `/Users/la/Programming/Tovu`.
- **UNVERIFIED:** runtime correctness, published 0.6.22 artifact contents, packaged desktop WebAuthn support, and live mail-provider configuration.

**Library recommendation**

| Purpose | Choice and placement | Download size |
|---|---|---|
| TOTP | `otplib@13.6.0`, inside a Jini adapter behind a TOTP port | Published compressed artifact **107 KB**, excluding dependencies. [Publisher release](https://github.com/yeojz/otplib/releases/tag/v13.6.0) |
| Passkeys | `@simplewebauthn/server@14.0.3` and `@simplewebauthn/browser@14.0.0`, behind Jini server/browser ports | **UNVERIFIED:** compressed package, dependency-total, and browser gzip sizes; registry/CDN access failed. Measure these in cloud before dependency adoption. |

SimpleWebAuthn supports Node LTS 22+, covering the planned Node 24 build. Its release history supports the server-version choice. [Documentation](https://simplewebauthn.dev/docs/packages/server/), [publisher releases](https://github.com/MasterKale/SimpleWebAuthn/releases).
Do not substitute unpacked package sizes for download sizes or implement either protocol’s cryptography ourselves.

**3. Ordered plan**

Line estimates below separate production changes from tests and exclude lockfile churn.

1. **Adopt the already-written recovery/durable-notification APIs.**
   Files: Jini package exports/manifests only if necessary; Tovu `package.json`, `package-lock.json`, and focused package-adoption tests.
   Verify packed Jini artifacts contain the required exports, then update only the affected dependency set. Preserve other jobs’ edits.
   **Size:** +10–30 / −0–10 production; +60–100 test lines. **Why it cannot be smaller:** current source and installed contracts disagree; source-only tests cannot prove Tovu uses the new behavior.
   **Proof:** packaged-export contract checks; existing recovery-code, reset-route, CLI, recovery UI, and migration suites against the adopted artifacts. Establish the unchanged-tree Node 24 baseline first.

2. **A — complete the existing notification path; no new queue.**
   Files: Jini `cms/src/forms/{ports,notify-subscriber}.ts` and their tests; Tovu `runtime/boot/mail-delivery-policy.ts`, existing outbox-policy tests, and a notification restart integration test.
   Preserve bounded retry hints and distinguish definitive failure from unknown outcome. For forms, stop automatic resend after an uncertain provider result; retain the existing ledger/status evidence. Keep authentication mail interactive.
   Retain reference-only jobs and today’s definition-at-delivery behavior. Test partial enqueue, replay, and startup ordering; change those implementations only where a failing test demonstrates loss.
   **Size:** +40–90 / −10–25 production; +180–260 test lines. **Why it cannot be smaller:** enabling readiness alone neither adopts the durable subscriber nor preserves safe retry decisions.
   **Proof:** enqueue→restart→deliver; crash after provider acceptance; duplicate source/claims; partial fan-out; sibling failure isolation; 429 delay; permanent refusal; unknown outcome without blind resend; deleted source; configured sender. Run storage cases on SQLite and real PostgreSQL.

3. **D1 — add the smallest reusable TOTP/session transition in Jini.**
   Files: `user-management/src/server/auth-service.ts`; new `server/mfa/{ports,service,totp-adapter}.ts`; server exports; package manifest.
   Reuse credential verification instead of calling session-producing `login()` first. Return either an ordinary successful login or a short-lived pending authentication result. Pending authentication grants no admin permissions.
   Use otplib for generation/verification; reuse sealing with workspace/principal-bound authenticated data. Activate only after proof; atomically advance the accepted timestep and consume pending authentication before session creation.
   **Size:** +220–320 / −15–35 production; +220–320 test lines. **Why it cannot be smaller:** factor verification, replay protection, and withholding sessions are the security boundary.
   **Proof:** library vectors; expired/wrong codes; concurrent replay has one winner; failed attempts remain spent; unconfirmed enrollment grants nothing; rollback creates no session; unenrolled login retains existing behavior.

4. **D1 — wire storage, login, enrollment, and recovery.**
   Files: Tovu `features/identity/{wiring,mfa.repo}.ts`, `dev-auth.ts`, narrow MFA routes, owner-recovery routes, and an append-only ADR-066 migration plus checksum/type/parity fixtures; Jini React MFA components/ports, mounted by Tovu’s existing Login/Security screens.
   Recommend owner opt-in first. Add only factor and pending-authentication storage; existing member email challenges are a different realm. Reuse the identity transaction and session repositories.
   Enrollment, replacement, removal, and recovery-kit rotation require recent authentication and an existing factor when enrolled. Ordinary password reset preserves factors. Explicit code/host recovery clears factors, pending proofs, sessions, and the kit atomically, with clear UI wording.
   Normal boot-token sign-in must respect enrollment. Private launcher proof may authorize an explicit recovery action without granting a normal session first.
   **Size:** +300–450 / −30–60 production; +280–400 test lines. **Why it cannot be smaller:** durable state and every session-issuing/recovery entry point must agree; a UI-only implementation is bypassable.
   **Proof:** SQLite/PGlite contracts plus real-PostgreSQL race tests; migration upgrade/checksum/parity; no cookie before completion; boot bypass rejection; recovery rollback; password reset preserves factors; React enrollment, challenge, cancellation, errors, and accessibility.

5. **D2 — add passkeys through the same pending-authentication service.**
   Files: Jini MFA passkey adapter/browser component and tests; Tovu thin credential repository/wiring, routes, and one additive credential migration.
   Use SimpleWebAuthn ceremonies with single-use, purpose-bound challenges, required user verification, credential ownership checks, and library counter handling. Keep public keys/counters; never store private keys.
   Derive expected origin from trusted site configuration/listener state, including the actual port—not request headers. Keep RP ID stable across port changes. Unsupported environments explain the limitation and retain TOTP/recovery.
   **Size:** +220–340 / −0–20 production; +220–340 test lines. **Why it cannot be smaller:** registration, assertion verification, and origin binding are inseparable; the TOTP session machinery is reused.
   **Proof:** wrong origin/RP/site/principal; expired/reused/concurrent challenge; missing user verification; invalid signature; zero/nonzero counters; cancellation; virtual-authenticator registration/login; changed local port. Packaged Electron compatibility remains a separate release check.

For all steps: new public boundaries use `(requiredObject, optionalObject)`; generic decisions stay in Jini, Tovu supplies storage/transport adapters. Complexity stays ≤10, desktop ≤9. Reuse existing tracing and actionable errors; never log factors, codes, or assertions. Missing configuration warns and disables the affected action without refusing application boot.

**4. Cost — frequency × payload**

Proposed bounds below are budgets, not measurements.

| Operation | Added frequency × payload |
|---|---|
| A fixes | **0 additional reads/writes/polls.** Existing path: one definition read/submission; one reference outbox insert/recipient, roughly 0.5–1 KiB; two source reads/recipient attempt plus existing mail-policy operations and one provider send. |
| A scheduling | **0 new timers.** Reuse existing one-second idle drain, batches of 20, and eight-attempt external-delivery policy. |
| MFA availability/login | One factor lookup/owner password login, ≤1 KiB. Enrolled login adds one pending-proof write, ≤1 KiB. |
| TOTP completion | Per attempt: ≤5 bounded reads and ≤4 writes, each ≤1 KiB, including attempt accounting and successful consumption/timestep update; existing session write remains. |
| Enrollment/change | Per explicit action: ≤4 reads and ≤3 factor/challenge writes, each ≤1 KiB; existing session revocation scales with the owner’s sessions. |
| Passkey ceremony | Begin: one challenge write plus ≤5 credential rows read. Finish: ≤3 reads and ≤3 writes; credential rows ≤4 KiB. Proposed request limits: registration 16 KiB, authentication 8 KiB. |
| Cleanup/telemetry | No new background poll. Bound pending records per principal/purpose and replace expired records on use; one redacted outcome event/ceremony, ≤512 B. |
| Dependencies | Once per uncached install/version: otplib 107 KB plus dependencies; SimpleWebAuthn totals **UNVERIFIED**. Lazy-load its browser adapter only on passkey use. |

**5. Exclusions and CUT-CANDIDATES**

- **C is CUT:** A does not require template/SQL-mail extraction or `@jini-ai/db/mail`.
- **CUT-CANDIDATES:** frozen email envelopes, notification plan-schema redesign, QR-code dependency, remembered-device policy, passwordless account discovery, and an MFA dashboard.
- Park member MFA, Google/OIDC changes, newsletter durability, hosted relay, password-policy changes, and broad UI refactors.
- No provider SDKs in core, new agent plugin, plugin-to-plugin imports, or custom cryptography.

**6. Effort and dependencies**

| Delivery | Codex work |
|---|---:|
| Package adoption prerequisite | 2–4 hours |
| A completion and focused validation | 6–10 hours |
| D1 TOTP, storage, UI, recovery, tests | 22–34 hours |
| D2 passkeys and browser validation | 14–22 hours |

Use paired Tovu/Jini branches: **`ml-a-notification-mail`**, then independent **`ml-d-totp`**, then **`ml-d-passkeys`** from D1. D has no technical dependency on A; deliver A first as requested.
Each branch records a short acceptance contract/ADR, starts fixes with failing tests, and passes packed-package consumer checks in the Node 24 cloud environment. Existing dialect tests cover SQLite/PGlite; real PostgreSQL concurrency must be exercised explicitly.

**7. Owner questions**

- **Who gets MFA first?** Recommend the site owner first; staff and visitor/member accounts follow separately.
- **Should enrolled owners still enter desktop automatically?** Recommend requiring their factor for normal sign-in, while retaining a clearly labelled recovery action backed by the existing private launcher proof. This plan assumes that choice.