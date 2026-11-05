Software Architect(Direct): Loaded the Software Architect profile. **P2 can ship in three independent increments: durable notifications, owner recovery, and the remaining Jini extraction. TOTP/passkeys come later.**

**Goal**

Make notification delivery survive restarts, give owners a way back in without email, and finish moving reusable mail behavior into Jini.

Read-only inspection completed; no files changed, tests/builds/servers run, or localhost requests made. Jini’s checked-out branch is `merge-1029`. Graph tools were unavailable; findings use targeted source searches.

**Findings — file:line**

Paths below refer to the two integration clones. The requested [todo item 2](/Users/la/Programming/Tovu/development/todos.md:28), [audit email/login section](/Users/la/Programming/Tovu/ADS-memory/.local-artifacts/debate-followthrough-audit-2026-11-02.md:48), and [10-24 report](/Users/la/Programming/Tovu/ADS-memory/reports/swarm-consensus/runs/2026-10-24-email-users-login-consensus-report.md) supplied the intent.

| Finding | Evidence |
|---|---|
| The exact blocker is `mailDurableOutboxReady = (...) => false`; delivery and readiness probes share it. | [Tovu deps.ts:1969](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/deps.ts:1969) |
| The durable outbox and serving-process drainer already exist. Handlers attach before draining starts. | [serving-app.ts:75](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/serving-app.ts:75) |
| Form notification failures are caught and logged. Merely enabling the flag would still allow failed mail to be acknowledged. | [Jini notify-subscriber.ts:106](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/notify-subscriber.ts:106) |
| Forms already have plan-once storage that atomically saves frozen child jobs. Reuse this mechanism. | [form-delivery-repo.ts:94](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/platform/db/repos/form-delivery-repo.ts:94) |
| Newsletter sending already uses leased recipient rows and outbox batches; only rate-limit outcomes defer automatically. | [send-pipeline.ts:272](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/newsletter/send-pipeline.ts:272) |
| Most mail infrastructure is already in Jini: resolver, policy, suppression, limits, SMTP and purpose gate. | [mail/index.ts:1](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/platform/src/mail/index.ts:1) |
| Template rendering and SQL mail repositories remain in Tovu. | [render.ts:1](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/email-templates/render.ts:1), [ledger.repo.ts:43](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/mail/ledger.repo.ts:43) |
| Owner password recovery already exists through boot environment settings; its helper captures a restore point and verifies the stored password. | [deps.ts:897](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/deps.ts:897), [reset helper:97](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/identity/reset-admin-password-self-verified.ts:97) |
| Jini’s password-reset transition already revokes the target’s sessions. | [admin-crud-service.ts:376](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/user-management/src/server/admin-crud-service.ts:376) |
| Desktop already has private launcher proof and loopback owner-session redemption. No new signing protocol is needed. | [dev-auth.ts:635](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/admin-http/dev-auth.ts:635), [site-backend.ts:188](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/desktop/src/main/boot/site-backend.ts:188) |

No recovery-code, TOTP or passkey implementation surfaced in the inspected identity paths. Existing Jini challenge/token/hash primitives provide reusable pieces.

**Design — smallest**

- **Durable mail:** extend the existing form-delivery plan with an additive email action: one frozen envelope per recipient, stored with its child outbox job. Replace the direct notification send; preserve existing notification settings.
- Provider failures affect that child job only. Retry confirmed retryable failures using existing backoff and stable ledger keys. Unknown provider outcomes remain visible and require reconciliation; never claim exactly-once SMTP delivery.
- Keep authentication mail explicitly interactive. Enable readiness for `forms` only after its persistent producer, handler and serving drainer are installed. Unknown capabilities remain closed.
- Newsletter remains independently gated until its existing pipeline preserves retryable provider failures correctly. Its campaign-content issue stays outside this increment.
- **Recovery codes:** add a small Jini recovery service using existing entropy, hashing, identity transactions and password-reset behavior. Issue ten high-entropy, single-use codes; store only scoped hashes. Display/download once.
- Code consumption, verified password replacement, remaining-code invalidation and session revocation must commit atomically. A code authorizes recovery of its existing owner only.
- **Desktop reset:** use existing private launch proof to regain an owner session, then invoke the owner reset transition. Never promote a signed-in staff account.
- **Self-hosted reset:** retain the existing `TOVU_ADMIN_RESET_PASSWORD` / `TOVU_ADMIN_RESET_USERNAME` fallback. Add a supported CLI wrapper with hidden password input, correct owner resolution and no password in arguments.
- **Jini ownership:** extend existing packages; no new mail service/package. Generic mail operations belong in `@jini-ai/platform/mail`; SQL adapters can use an isolated `@jini-ai/db/mail` entry. Tovu retains site settings, Pages storage, authorization bindings, vault/plugin loading and routes.
- Public boundaries take `(requiredArgs, optionalArgs)`. Preserve “why” comments when moving code. Complexity ≤10, desktop ≤9.

**Steps — ordered, files**

1. Record acceptance criteria and the small ADR/contract outline before implementation. Pin atomic recovery and durable-enqueue ordering as explicit invariants.
2. **A — durable forms mail, independently shippable.** Extend Jini `packages/cms/src/forms/delivery/{types,planner}.ts` and notification handling; put generic mail-result classification in `packages/platform/src/mail/`.
3. Wire Tovu `composition/form-delivery.ts`, `modules/forms.ts`, `outbox-retry-policies.ts`, `serving-app.ts` and `deps.ts`. Reuse current tables and retry schedule; no new queue or polling loop.
4. Update form-job purge and existing mail retention for email envelopes. Scrub terminal payloads after settlement; retain pending work and body-free failure history. Enable only forms readiness.
5. **B1 — desktop/host reset, independently shippable without mail or recovery codes.** Extract verification behavior into Jini user-management; retain Tovu’s restore-point adapter. Add CLI wiring under `cli/commands/` and desktop action through `project-ipc.ts`, preload and renderer adapters.
6. **B2 — recovery kit, independently shippable without A or MFA.** Add Jini `user-management/src/server/recovery-codes.ts` and recovery UI through its existing React surfaces; Tovu adds thin routes and repository wiring.
7. Add one append-only ADR-066 TS migration for recovery hashes, scope and consumption state; update `migrations/index.ts`, checksums and generated type/parity fixtures. Use the next free migration ID; Drizzle stays frozen.
8. **C — finish mail extraction, independently shippable.** Move template grammar/sanitization from `features/email-templates/render.ts`; move generic repositories/retention from `features/mail/` and generic operations from `features/mail-status/`. Preserve public behavior with thin Tovu facades, then update imports.
9. Publish Jini before updating Tovu’s registry dependencies. Provider implementations remain exclusively under `@jini-ai/agent-plugins/<subpath>`.
10. **D — later, separate MFA phase; plan only.** Ship TOTP first, then passkeys independently once origin behavior is proven.

For D, use **`otplib`** for maintained OTP generation/verification; encrypt secrets with the existing sealer and atomically persist the last accepted timestep to prevent replay. [otplib documentation](https://otplib.yeojz.dev/guide/advanced-usage)

Use **`@simplewebauthn/server`**, with `@simplewebauthn/browser`, for maintained WebAuthn ceremonies and verification. Persist single-use challenges, credentials and counters; bind expected origin/RP ID and require user verification. Verify packaged runtime compatibility. [SimpleWebAuthn documentation](https://simplewebauthn.dev/docs/packages/server/)

MFA enrollment/replacement requires recent authentication. Recovery must remain an explicit authenticated procedure; ordinary password reset must not silently clear factors. [OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)

**Tests — RED first, DI fakes; proposed only**

- Mail: restart after enqueue, partial fan-out, concurrent claims, provider refusal, retry exhaustion, unknown outcome, configuration changes and repeated domain events. Assert persisted outcomes and provider calls.
- Recovery: concurrent code redemption has one winner; wrong workspace/realm/owner and rotated codes fail; verification failure rolls back consumption/password changes; old sessions stop working.
- Desktop/CLI: fake launcher, IPC and filesystem ports; reject wrong sender/site, remote requests and staff promotion. No secrets in logs or process arguments.
- Extraction: characterization tests for template escaping/sanitization, public auth-capture redaction, suppression and ledger replay; SQL adapter contracts on SQLite and Postgres/PGlite.
- Later MFA: injected clock/crypto/verifier/store; test TOTP replay races, challenge reuse, wrong origins/RP IDs and enrollment/removal authorization.

**Cost — frequency × payload size**

| Operation | Budget |
|---|---|
| Form planning | Per submission: definition/submission/settings reads; one plan marker plus two row inserts per recipient. Frozen email envelope capped at a proposed 64 KiB; reject oversize visibly. |
| Delivery | Per recipient attempt: one envelope read, existing settings/suppression/ledger operations and one provider request. Reuse the existing external-delivery cap of eight attempts. |
| Polling/cleanup | **No new timers.** Existing 1-second drain, batches ≤20; extend minute retention with a bounded terminal-envelope scrub, ≤100 rows/pass. |
| Recovery | Per kit: ten hashes, roughly a few KiB total. Per attempt: bounded owner/code reads; success writes credential/code state, audit metadata and revokes `s` sessions. No polling. |
| Host fallback | Per actual reset: existing full database restore-point copy, proportional to database size; avoid repeating it when the password already verifies. |
| Later MFA | Per ceremony: a few small challenge/credential rows; typically <10 KiB application payload. No background polling. |

**Risks**

- Provider acceptance followed by process failure leaves uncertainty; the existing ledger must prevent blind resends.
- Export/purge must cover queued bodies and recovery hashes. Recovery-code issuance belongs after restore-point creation so rollback cannot resurrect spent codes.
- Desktop changing loopback ports and site-domain changes complicate passkeys; retain TOTP/recovery and prove origins before enabling passkeys.
- Sender credentials/domain readiness were not checked against a live deployment. Readiness must distinguish durable wiring from provider configuration.
- Rollback disables new producers/readiness but preserves queued work and additive schema; older consumers must never acknowledge unknown email jobs.

**Out of scope**

Hosted relay, provider selection or credential changes, member-login redesign, password-floor changes, new automation pages, campaign-content repair, custom cryptography, and implementing MFA now.

**Estimate**

A: 3–4 engineer-days; B1: 1–2; B2: 2–3; C: 2–4. **Current scope: 8–13 days including targeted tests/review.** Later D: approximately 4–7 additional days, with desktop passkey origin validation the main uncertainty.