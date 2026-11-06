# last-fixes — in progress

Branch: `cloud/last-fixes`. Base: `01ff07e895d1f48a012f48b33ceb4ee5527c3358`.

Owner-approved job: Jini `origin/cloud-plans-1105:cloud/jobs/last-fixes.md`; common rules from `cloud/jobs/COMMON.md`. Started 2026-11-06 19:15 UTC, hard stop before 21:15 UTC.

Dependency rebuild and consumer relink in progress. Independent fix tracks assigned; item 20 will be committed separately.

## Bugs found

- Initial pnpm install failed because its store was outside writable roots; resolved with scoped filesystem permission for the existing pnpm store.

## Validation

Pending targeted regression tests, touched package TypeScript and complexity checks. Full suites are reserved for the separate final test run.
