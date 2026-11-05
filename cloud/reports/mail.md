# Mail job — 2026-11-05

Implemented ML part A only, as narrowed by cloud/jobs/mail.md and TRIM.md. Runtime validation passes. Repository-wide Tovu typechecks remain blocked by unchanged code outside this job. No MFA, dependency bump, release, deployment, or publish work was included.

## Branches and commits

Both repositories use `cloud/mail`; every push explicitly targeted `HEAD:refs/heads/cloud/mail`. Each existing-branch push was preceded by `git pull --rebase origin cloud/mail`; no force push.

- Jini base: `6f507852d50cc5b22914917ad3a80f1168feccee`.
- Jini implementation commits, oldest first: `c9ea933d5`, `c7411e168`, `95f870ce5`, `7c5835eab`, `e89be80d9`, `9bdb7d619`.
- Tovu base: `e327c07c8fc220fa8612ba1eb60c81c28b8a900f`.
- Tovu implementation commits, oldest first: `3e2f15796`, `df1973f9c`, `b517bd609`, `1d0da178a`, `d95f4bfec`.

This report is committed after implementation and validation. Its commit is the branch head reported in the final response.

## Changes and acceptance evidence

- CMS Forms mail results retain `retryAfterMs` and `unknown`. Notification errors reuse `FormDeliveryError` to validate/cap hints at one hour and distinguish definitive refusal from uncertain acceptance.
- Unknown acceptance overrides a contradictory retryable flag, becomes a terminal notification error, and carries a safe actionable message. Provider messages and submitted answers do not enter the outbox error.
- Unclassified host exceptions retain their previous retry behavior without claiming definitive non-delivery. Existing typed notification failures retain their metadata.
- Tovu selects the existing `never` resend policy for forms. A previously unknown ledger row cannot be reclaimed for another automatic send; definitive failure retries continue.
- The restart test uses existing SQL repositories, the real outbox worker, delivery wrapper and ledger. SQLite closes/reopens its file; PostgreSQL closes/reopens connection pools against a disposable database initialized with registered migrations.
- Tests prove source and recipient-job survival across restarts, duplicate source fan-out deduplication, configured sender/notification lane, sibling isolation, a provider delay longer than host backoff, no early retry, unknown ledger evidence/no resend, and no second provider call after acceptance followed by interruption before ledger marking.

Reuse: retry validation and outcome handling use CMS `FormDeliveryError`; scheduling uses the existing form-delivery outbox policy; resend prevention uses platform mail policy and the SQL ledger. Searches covered CMS Forms notify/delivery, platform mail result/policy/wrapper, Tovu outbox policy/worker, mail ledger and forms wiring. Codebase Memory MCP and Graphify were unavailable; the available semantic index had no matching notification entry, so source reads and rg confirmed ownership.

State cost: **0 added reads, writes, polls, timers, or provider calls**. Existing per-recipient work and reference-only jobs are unchanged; only failure metadata and the existing resend decision change.

## Exact validation commands and results

All commands ran in this container with Node `v24.22.1`, after `source /workspace/.tovu-build/env.sh`. PostgreSQL cases require subprocess/network access enabled for the execution command.

Setup named in COMMON was missing at `/workspace/shared/dev-env.sh` and `start-postgres.sh`; the existing equivalents under `/workspace/.tovu-build/` were used. The package store/cache was redirected to writable scratch storage.

From /workspace/Jini:

```sh
pnpm install --frozen-lockfile --store-dir /workspace/work/mail/pnpm-store --cache-dir /workspace/work/mail/cache
pnpm -r build
npm --prefix packages/cms run typecheck
npm --prefix packages/cms run build
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/cms/src/forms/ports.ts packages/cms/src/forms/notify-subscriber.ts
npm --prefix packages/cms run test -- src/forms/__tests__/notify-durable.test.ts src/forms/__tests__/notify-subscriber.test.ts src/forms/__tests__/notify-subscriber.host-options.test.ts src/forms/delivery/__tests__/errors.unit.test.ts src/forms/delivery/__tests__/retry-policy.unit.test.ts --coverage --coverage.include=src/forms/notify-subscriber.ts --coverage.reportsDirectory=/workspace/work/mail/cms-coverage
```

All pass. Focused tests: **72 passed, 0 failed**. Subscriber coverage: **100% statements, lines and functions; 94.23% branches (49/52)**. The three uncovered branches are existing paths at lines 74, 87 and 124. No coverage exclusions, thresholds, tests, rules or checks were weakened. Initial notification baseline: 26/26 passed; new regression cases failed before the fixes.

From /workspace/Tovu:

```sh
npm --prefix packages/contracts run build
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/server/runtime/boot/mail-delivery-policy.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-reporter=spec apps/website/src/server/runtime/boot/__tests__/mail-delivery-policy.unit.test.ts apps/website/src/contracts/core/events/__tests__/forms-notification-retry.test.ts apps/website/src/contracts/core/events/__tests__/forms-notification-restart.integration.test.ts
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/tsc -p tsconfig.tests.json --noEmit --incremental --tsBuildInfoFile /workspace/work/mail/tovu-tests.tsbuildinfo
```

Contracts build, local linking, strict complexity lint and **19/19 focused tests pass**, including all four SQLite/real-PostgreSQL restart cases.

Production tsc exits 2 with one error: `apps/website/src/features/deployments/publish-credentials/store.ts:410`, TS2322 (`string | undefined` passed where `string` is required). That file is unchanged from the specified base. Test tsc exits 2 with 50 errors outside the changed mail files; the new fixture's initial kernel type mismatch was fixed and is absent from the final output. These unrelated errors were listed rather than fixed. Full test suites were not run, as instructed.

Both repositories: `git diff --check` passes.

## Review and completion checks

Architecture audit: **PASS**. Generic delivery/error semantics remain in Jini; Tovu supplies the existing module policy and SQL wiring. No schema, migration, new service, vendor dependency, queue, plugin or public factory was added. Required-object/optional-object signatures remain intact.

Function assessment:

| Unit | NLOC | Time / space | Final disposition |
| --- | ---: | --- | --- |
| FormNotificationError constructor | 10 | O(1) / O(1), no I/O | NO_RECORDED_FINDINGS |
| sendNotification | 41 | O(submission size) / O(submission size); one existing mail call | NO_RECORDED_FINDINGS |
| resendPolicyFor | 5 | O(1) / O(1), pure policy | NO_RECORDED_FINDINGS |

The initial complexity finding was fixed by flattening existing control flow and forwarding optional metadata directly, without introducing a helper abstraction. Final strict lint passes at the required ceiling of 10. A second review checked names, raw versus typed errors, privacy, contradictory unknown/retryable flags, invalid/oversized hints, restart replay and retained failure evidence. Read-only Sidekick review found no material correctness gap. No remaining Critical/High finding in the changed behavior.

Runtime self-validation: **PASS**, using the retained restart integration tests and focused consumer tests. Overall validation remains **PARTIAL** because of the unrelated Tovu typecheck failures above. Requirements re-read; no certified assertion was weakened/deleted; changes stay within ML A. Local logs and coverage are scratch artifacts under /workspace/work/mail, not committed.

## Bugs and open items

BUG FIXED: Forms notification conversion discarded provider retry-delay and unknown-outcome metadata.

BUG FIXED: Tovu forms selected on_unknown, allowing an unknown ledger row to be reclaimed and re-sent.

OPEN, outside scope: the existing SMTP adapter classifies unfamiliar caught errors as ordinary retryable failures without the unknown flag; this job does not change provider classification.

OPEN, outside scope: freshPostgresContentDatabase's static schema helper omits mail tables. The new tests use freshPostgresDatabase plus migrateContentDatabase instead.

OPEN, outside scope: Tovu production tsc error at publish-credentials/store.ts:410 and the 50 unrelated test-type errors.

The untracked Jini packages/plugin-ui-ux-design directory left by the supplied workspace/base checkout was not changed or committed.
