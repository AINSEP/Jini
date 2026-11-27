# Y5M pub — Jini working-tree handoff

Scope: P1, P3 together, then independent P2. No git writes or execution of installs, builds, tests, typechecks or linters.

Design constraints: existing backup/site modules and exports own the behavior; fixed ports retain raw host requests by reference; no product identity or host schema moves. Preserve authorization, effect order, plan/job isolation and resource cleanup. Existing split functions and catalog are the style seed approved by the dispatch.

1. P1/P3: host-typed plan content and invocation-time tool dependencies.
   - Tests first: backup-service.test.ts and tool-registrations.test.ts.
   - Mutation `restamp-at-push`: replace saved version A with push-call source version B; the uploaded manifest bytes must differ.
   - Mutation `resolve-deps-at-registration`: hoist dependency resolution into contributor build; zero-build-resolution and two-context assertions must fail.
   - Files: packages/devops/src/backup/site/backup-service{,.plan,.credentials,.push,.shared}.ts; tool-registrations.ts; their two __tests__ files; .changeset/y5-site-backup.md.
2. P2: explicit staging scope precedence and injected staging I/O.
   - Tests first: packages/devops/src/backup/site/share-database/__tests__/projection.test.ts.
   - Mutation `overwrite-archive-temp-root`: restore the forced archive default; explicit archive I/O-root assertion must fail.
   - Files: packages/devops/src/backup/site/share-database/projection.ts and __tests__/projection.test.ts; .changeset/y5-site-backup.md. No staging split was needed after separating ShareProjectionHost.

Validation: static diff review only; all executable checks reserved for coordinator.
Keep rules: none added in this Jini-only clone; the three host files must be verified as G3 in the host half before adding rules.
Deletions during final scope review: removed obsolete concrete credential-repository/sealer/provider-loader imports, the producer field and copy, the registrar's service-deps binder and Object.assign assembly, the forced archive-root override, stale fixture service fields, and the superseded nested-producer assertions. No production files deleted; no unrelated code added.
Status: P1/P3 and P2 Jini implementation complete in the working tree; no anchor blockers. Static diff review completed. No executable checks were run; no pass/fail or mutation execution is claimed.

Test counts: backup-service 6 -> 6 (replaced nested-producer cases with flat content/job-isolation and key-status characterization); tool-registrations 3 -> 4; projection 2 -> 2 (extended existing staging case). All original refusal, authorization, cancellation and unknown-populated-table cases remain.

Existing export paths used by the host handoff (no new subpaths or package-version changes):
- @jini-ai/devops/backup/site/backup-service: new createSiteBackupService, SiteBackupRequestDeps and SiteBackupRepositoryPlanContent; SiteBackupPlan<TContent> now carries flat host content.
- @jini-ai/devops/backup/site/tool-registrations: new bindSiteBackupTools; it returns siteBackupAgentToolCatalog, buildSiteBackupRegistrations({ deps, surfaces }, {}) and contributeSiteBackupTools({}, {}). The old standalone build/contribute exports were replaced by these bound operations.
- @jini-ai/devops/backup/site/share-database/projection: existing createShareDatabaseProjection<TParams> and four bound operations; new ShareProjectionHost type, required host.statfs and host.writeFile.

Host work remaining: construct the P1 factory with createSiteBackupPushJobs and completePlanContent, adapt credential/provider ports to receive { deps: rawRequest }, inject both credential-store error classifiers and the host selector; inject P1 operations and invocation-time resolveDeps into P3; bind Node statfs/writeFile and both staging scopes for P2. Finish the three host G3 bindings and their keep rules in the host clone. Existing host manifest/integration tests remain the host's responsibility.

LEFT: C1-C3 excluded by scope. LEFT-DESKTOP dependency pin/lock refresh dropped by coordinator fix; no package.json dependency versions or lockfiles changed. COMMIT-PLAN.md is coordinator scratch and must not be committed.
