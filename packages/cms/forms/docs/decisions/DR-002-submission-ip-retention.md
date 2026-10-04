# DR-002: retain submissions while expiring their submitter IP

Owner decision 2026-10-04: automatically delete form submission IP addresses after 90 days,
preserving the submission. The privacy copy describes the same 90-day rule.

The framework-free package supplies one policy constant and `sweepExpiredSubmissionIps`.
A separate `SubmissionIpRetentionPort` clears only metadata in atomic, bounded updates across
workspaces, including rows in Trash. Keeping maintenance separate from the ordinary submission
repository avoids adding mutable admin operations to the anonymous submit/read contract.

Hosts provide databases and boot/daily scheduling. A pass fixes its cutoff once and drains full
batches. An adapter returns affected rows rather than selected rows, so concurrent sweeps cannot
count already-cleared addresses. Setting NULL is idempotent and needs no distributed lease.

Source IP is nullable in persisted records; the anonymous HTTP input still requires a string.
Submission answers, timestamps, IDs, versions and Trash state stay unchanged. Rate-limit keys,
comment hashes, member/session/consent metadata, operator logs and backups have separate policies.
The sweep does not redact arbitrary user-provided form field values.

No new timer or concrete store lives in Jini. Hosts with the earlier package release can check
for the additive export; hosts with NOT NULL schemas must install a nullable migration before
invoking the maintenance adapter. Release/schema installation is an operator responsibility.
