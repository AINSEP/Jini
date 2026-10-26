Spec ID: SPEC-JINI-CMS-FORMS-BEHAVIOR
Version: 2.2.0
Last Edited: 2026-10-26
Hash: sha256:eae39677b50814d5ba2f68dc824a6f83bf708f7f3054b9ab693ab194b31df154
spec_mode: reverse_spec
Hash basis: UTF-8 Markdown body from the first heading through EOF


# Forms behavior contract

## Definition validation and writes

- Names have length 1–200; whitespace is not trimmed. Slugs match `^[a-z0-9][a-z0-9-]{0,63}$` and must not occur in the host's reserved set. Slug uniqueness, including trashed reservations, is an adapter obligation; the service does not call `isSlugTaken`.
- A definition has 1–20 fields. IDs match `^[a-z][a-z0-9_]*$` and are unique. Labels have length 1–200. Types are exactly `text`, `email`, `textarea`, `checkbox`.
- A non-null `maxLength` is compared against 1–5000; checkbox fields forbid it. There is no integer/finite check on that number. `required` is trusted as typed input; no runtime boolean check exists.
- Optional class names are strings of at most 300 characters. Attributes allow at most 12 entries; string values have length at most 300. Names match `aria-*`, `data-*` (lowercase letters/digits/hyphens after the prefix), or exactly `placeholder`, `autocomplete`, `inputmode`, `pattern`, `title`, `min`, `max`, `step`, `minlength`, `spellcheck`, `readonly`.
- Descriptor errors accumulate: field-count errors first, then fields in input order; within each field: ID, type, label, max length, class name, attributes. An invalid attribute name suppresses its own value error.
- Notification defaults are `{enabled:false,recipients:[]}`. `enabled` must be boolean; recipients must be an array of at most 10 addresses matching the service's simple email pattern. No recipient deduplication or relationship between enabled state and recipient count is imposed.
- Create validates before invoking the host command executor, then creates an active record with `version:1` and equal created/updated timestamps. ID allocation precedes command execution.
- Update keeps the original slug even when `patch.slug` is supplied. All existing field IDs must remain; adding fields, reordering them or changing descriptors is allowed. Name and notify changes are validated. Status writes retain the row.
- Update/status operations call the executor before loading and validating their mutation. The executor controls authorization, audit and command-key deduplication. The provided mutation captures a null inverse and has no rollback callback. These writers alone do not guarantee revertibility or atomicity with the audit record.
- Update and status writes preserve the existing version; there is no expected-version check or increment.

## Submission ordering and normalization

1. Load by workspace and slug. Missing and non-active definitions throw the same not-found class.
2. A nonempty trimmed string `_hp` returns `{status:"accepted"}` with no validation, rate check, persistence or event. Non-string and whitespace-only values do not trip the honeypot.
3. Validate the payload. Unknown keys are reported in body key order before declared-field errors in definition order. `_hp` is allowed and excluded from stored data.
4. Check the key `${sourceIp}:${formDefinitionId}` with the host limiter. Invalid payloads never consume this check.
5. Allocate a submission and persist normalized data, then enqueue `form.submission.received` with `{workspaceId,formDefinitionId,submissionId}` and `aggregateId:submissionId`.
6. Start dispatcher work in a promise microtask and return `{status:"accepted"}`. Dispatch and logging failures are caught; delivery completion is not awaited.

Text/email/textarea values must be strings. Required text rejects trimmed emptiness, but stored strings retain whitespace. A declared `maxLength` is enforced against raw string length. Email fields do not validate email syntax. Optional null/undefined fields are omitted. Checkboxes accept booleans or exactly `"on"` → `true`; a required checkbox with `false` is valid. Other strings are rejected.

There is no submission idempotency key. A retry after persistence but failed enqueue may create another row. Persistence and enqueue are separate awaited effects; the package does not provide a transaction or compensation.

## Notifications

The registered handler reads the current definition and submission. Missing records, disabled notification config and empty recipient lists yield no sends. Form status itself is not checked, so changing a form to disabled does not cancel notification for an already persisted event.

Recipients are sent sequentially in stored order, using the host sender, subject `New submission: ${definition.name}` and `JSON.stringify(submission.data)` as text. Dedup keys are `forms:notify:${submissionId}:${recipient}`. The mail adapter must enforce them; the subscriber keeps no delivery ledger. Send failures and throws are logged and do not stop later recipients. Repository and logger failures are isolated. There is no subscriber retry, timeout or backoff; a retryable mail result is only logged.

## Deliberate boundaries

The package supplies no HTTP status mappings, auth sessions, UI controls, CAPTCHA, source-IP trust policy, submission-content purge/delete service, response-size limits, rate window, mail sender discovery, scheduler or concrete persistent store. Typed definitions are not a general parser for arbitrary JSON; consumers validate outer request shapes before calling.

## Submission IP retention

`sweepExpiredSubmissionIps({ now, repo }, { batchSize? })` fixes an ISO UTC cutoff exactly 90 days before the supplied epoch milliseconds. It clears submitter IPs at or before that cutoff (inclusive), drains full batches (500 by default), and returns the total affected rows. Repeated passes clear nothing further. Invalid timestamps and non-positive/non-integer batch sizes reject before persistence. Storage errors propagate to the host timer, which logs and retries. The adapter must atomically guard non-null IPs and the cutoff, include Trash and all workspaces, and change no submission data, identity, timestamp or Trash state. See [DR-002](../decisions/DR-002-submission-ip-retention.md).

Evidence: `src/forms.ts`, `src/write-service.ts`, `src/submit-service.ts`, `src/notify-subscriber.ts`; validation characterization, write, submit and subscriber tests under `src/__tests__/` were read, not executed.

Known test integration drift: `src/__tests__/eventing.fixture.ts` uses positional subscription, and `src/__tests__/change-set.fixture.ts` uses positional insert. CMS core now declares object arguments for both. Those fixtures do not establish compatibility with the current exported host ports.

Decision rationale: [Anonymous submissions isolate spam and notification failures](../decisions/DR-001-anonymous-submission-containment.md).

## Phase 1 live timing addendum (2026-10-26)

This addendum governs the active `@jini-ai/cms/forms` implementation under `packages/cms/src/forms`, superseding older snapshot statements above about missing attempt coordination, transactions and HTTP adapters. See [DR-004](../decisions/DR-004-basic-live-submission-timing.md).

- A host opting into attempts strips `_attempt` before validation/body hashing. Its app-scoped store also observes live-issued opaque tokens by workspace/slug/server time, independently of the existing 60-second pending/accepted claim map.
- Issuance retains at most 10,000 records for at most two hours. Lazy pruning/capacity eviction uses no timer and retains no answers/IP. Re-registering an unexpired token cannot reset its age or change its scope.
- After valid answers and host rate admission, a known correctly scoped token aged 0–999 ms throws `FormSubmissionTooFastError`. At 1000 ms it proceeds. Missing, unknown, stale, evicted, mismatched and rollback-clock observations skip timing. Client timestamps never establish age.
- Timing refusal allocates no submission IDs and creates no claim, upload, submission, outbox event or conversion. The same token can retry. Existing honeypot behavior, host quotas, dedupe, rollback, upload compensation and asynchronous notification delivery remain effective.
- Tovu's existing committed-event visitor integration owns conversion counting; no additional observation/capture is introduced. Exported receivers remain a separate Phase 1B parity/migration task. Phase 2 vendor checks are excluded.
