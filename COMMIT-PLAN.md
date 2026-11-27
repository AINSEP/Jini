# Commit plan — y5n-pub, Jini half

1. P1 follow-up — completed in the working tree: honor the request sanitizer on shared backup operations.
   - `packages/devops/src/backup/site/__tests__/backup-service.test.ts`
   - `packages/devops/src/backup/site/backup-service.ts`
   - `packages/devops/src/backup/site/backup-service.plan.ts`
   - `.changeset/y5-site-backup.md`

Characterization test added before production edits: two planning requests on one
bound service save factory-sanitized bytes and request-sanitized bytes respectively.
Mutation `sanitizer-fixed-at-factory`: replace the request/default sanitizer
selection with `deps.siteBackupSanitize`; the second saved database assertion must
fail. Tests and mutation execution are deferred to the coordinator as instructed.

The existing factory, request type, plan sanitizer call and override anchors match.
The original P1 extraction is already present; only the dispatched follow-up applies.

Request override audit against the host backup service: store, jobs, clock, failure
log, key-status probe and push wait budget already select live request values.
Provider loader, credentials, sealer, HTTP client selection, observability and retry
sleep remain available through the existing typed raw-request ports. Sources,
authorization, workspace and database operations are already read from the request.
Only the sanitizer needs an added request slot and point-of-use selection.

Host follow-up: pass `siteBackupSanitize` on each raw request through the existing
`@jini-ai/devops/backup/site/backup-service` export. No new subpath or export is needed.
The host binding and keep-rule update are outside this Jini-only dispatch.

Static audit: PASS. The request remains referenced directly; sanitizer selection
stays after snapshot capture; no push, credential, provider or effect order was
changed. Reused the existing request/default selection pattern, existing fixture
and bound service. The touched capture function remains one job with constant
selection cost and no new resource lifetime. Test count: 6 before, 7 after; none
deleted or weakened. No unrelated additions found during diff review.

`git diff --check` passed. No tests, installs, builds, typechecks, linters, commits
or pushes run. Runtime, type and mutation verification remain for the coordinator.
No stopped Jini sheets or remaining Jini steps; the dependent host work remains.
Deletions during final review: none. Leave this file uncommitted.
