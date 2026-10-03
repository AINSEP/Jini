# Changelog

## 0.2.0 — 2026-10-02

### BREAKING

- Logging uses the canonical core Logger; public calls retain separate required and optional argument objects. The package remains private.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Compilation

- Align the in-memory event-bus fixture and subscriber test calls with the current CMS argument objects.
- Preserve the rejecting command-gateway mock's `Promise<never>` result so it satisfies the generic executor contract.
- Validate record payloads before catch-all fixture delivery instead of casting generic events; add batch/unsubscribe parity and invalid-payload regression coverage (not run).

### Kernel and bus contracts

- Use core runtime/JSON/ID/time types and `Pick<Logger, 'warn'>`; structured warning error data is passed in argument two.
- Pass notification subscriptions as `{ eventName, handler }` and change-set insertion as `{ record, items }, { event }`.


- Restore independent empty `fieldErrors` defaults for message-only field and
  submission validation errors.
- Validate name updates against the host's reserved-slug policy using the stored,
  immutable slug. Reject before persistence when a policy now reserves that slug.
- Add error-default and reserved-slug update regressions; execution is deferred by owner directive.

## 0.1.0 — 2026-10-01

- Move the unpublished CMS forms extraction and all of its tests into the independent `@jini-ai/cms-forms` package.
- Export form contracts, validation, definition writes, submissions, notification and rate-limit keys from the package root.
- Inject audited command execution through `FormCommandExecutorPort`; retain type-only CMS contract imports.
- Remove the CMS forms export and metadata entry without retaining an alias.
- Add standalone package and product-reference guard tests. Verification is deferred by owner directive.
