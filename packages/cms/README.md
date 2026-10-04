# `@jini-ai/cms`

Content-model capability for Jini-hosted products.

The source tree includes content domains and Node adapters. CMS depends on shared kernel
contracts and has no user-management dependency. Generic tool wiring is exported by
`@jini-ai/core`; hosts provide CMS authorization and active-principal lookup ports.
See [API integration](API-INTEGRATION.md) for current signatures and migration examples, and
[integration-report.md](integration-report.md) for pending protected work and deferred verification.

## Layers

| subpath | runtime | contents |
|---|---|---|
| `.` / `./core` | universal | Content contracts and types, ports, pure domain services, kernel registries. No Express, no `node:*`, no DOM. |
| `./media` | node | Media services, filesystem blob stores and image transformers. |
| `./http/settings` | node | Settings HTTP routes, host policy contracts, CMS adapters and resumable change feed. |

Node-bound domain adapters depend on `/core`. The reverse is a boundary violation — if a core module wants
something from a Node adapter, the dependency is backwards and the fix is a port (interface) in core,
not a widened export.

Domain HTTP adapters live under `./http/*`, using the generic transport and host
composition supplied by `@jini-ai/http-kit` and `@jini-ai/server`.
Identity tool registration composition belongs to `@jini-ai/user-management/server`.

`@jini-ai/cms/http/settings` exports `registerSettingsRoutes`, the settings HTTP
contracts and the CMS service/change-feed factories. Hosts provide route paths,
permissions, workspace, readiness, principal resolution, authorization, scheduler,
service and feed ports. Registration returns a disposer that closes active feeds.
CMS adapters pass named request objects to settings dispatch and change-feed services;
queryable index-name helpers return promises that callers must await.
Install the optional peers `express` and `@jini-ai/http-kit` when using HTTP subpaths;
the framework-free root and domain entries do not import them.
Readiness or principal-resolution failures return `401 UNAUTHENTICATED`.
Stream diagnostics are best-effort: a throwing reporter cannot prevent retries,
cancellation of other schedules or ending the response.

## Why the split exists before there is any code to split

The source of this port is an existing CMS runtime, and the boundary is drawn where a measured defect was.

There, the content model and its HTTP composition root share one `src/` tree with nothing
enforcing a boundary between them. Measured 2026-08-02:

- **53 import edges point into the composition root.** 22 of them are domain modules importing a
  454-line `RouteDeps` type whose first line is `import type { Express } from "express"`.
- **Git history shows the cost:** no content module could be changed without also changing the
  server. `features/theme` and `server` co-changed in 71% of commits touching the former;
  `identity` and `server` in 45%.
- **33 of 38 modules formed a single strongly-connected component** — none could be extracted
  without dragging the other 32.

The decomposition itself was sound (propagation cost 11%, a textbook Martin instability gradient,
domain modules that essentially never co-change with each other). What was missing was
*enforcement*. Full analysis: `ADS-memory/reports/refactors/2026-08-02-module-graph-analysis.md`
in the originating repo.

A package's `exports` map is precisely the enforcement a single `src/` tree cannot provide. A
consumer of `@jini-ai/cms/core` physically cannot reach a Node adapter, and `/core` physically
cannot import a transport type, because the module resolver refuses. Porting into this shape from
the first commit means that failure mode cannot recur here.

## Port inventory

The kernel went first — the source repo's `src/core/{ports,commands,events,tools}` — because every
domain module depends on it. Domain modules followed in no particular order: the source repo's git
history shows they essentially never co-change with each other, so each ports independently without
coordination.

**Landed** (directories under `src/`, each with its own subpath export):
`core`, `content-types`, `entries`, `media`, `navigation`, `presentation`, `settings`,
`taxonomy`, `workspace`, and `trash`. `./core/tools` exports CMS permission helpers; `./media/import` exports bounded image fetching with injected policies and ports.

**Still to move:** `post`, `seo`, `comments`, `redirects`, `widgets`, `newsletter`,
`members`. The unimplemented `./widgets` export has been removed.
The nested forms package is maintained by its separate owner and is excluded from this parent package.

**Explicitly not ported:**

- `src/server/**` — Express composition root; superseded by `@jini-ai/http-kit` / `@jini-ai/server`.
- Admin UI — `@jini-ai/admin` already owns that surface.

When porting tests, `git mv` them rather than re-authoring: re-authoring costs a full pass and
still loses coverage.

## Scripts

```bash
pnpm --filter @jini-ai/cms build
pnpm --filter @jini-ai/cms typecheck
pnpm --filter @jini-ai/cms test
```

## Open cleanup

- **Add coverage thresholds.** `vitest.config.ts` still has none. That was a deliberate omission
  while the package was a placeholder; it no longer is, so the reason has expired. Set them against
  what the ported modules actually measure — siblings run 98–100%.

## Design decisions

- [Schema indexes use closed fragments and unambiguous identities](docs/decisions/DR-001-safe-schema-and-index-transitions.md).
- [Content lifecycle separates new authoring from existing-entry writes](docs/decisions/DR-002-content-lifecycle-and-cleanup.md).
- [Settings preserve total defaults, scope fences and revision evidence](docs/decisions/DR-003-settings-ledger-invariants.md).
- [Blob collection rechecks references before journaled unlink](docs/decisions/DR-004-journaled-blob-gc.md).
- [Taxonomy validation preserves first-failure order and full cycle checks](docs/decisions/DR-005-ordered-taxonomy-validation.md).
- [Mutation, audit record and outbox intent share a commit boundary](docs/decisions/DR-006-mutation-audit-atomicity.md).
- [Workspace administration preserves tenancy and ownership floors](docs/decisions/DR-007-workspace-and-owner-floors.md).
- [Navigation mutations enqueue one event only on success](docs/decisions/DR-008-navigation-event-intent.md).

The `./trash` surface owns snapshot-only listing, keyset cursors, atomic marker/index writes,
transactional follow-ups and the retention sweeper. Hosts inject their table adapters, reentrant
transaction runner, `IdGenerator`, entity policy, `Clock` and scheduler. Native timer `unref` and
error logging belong to the host. Actor/prior-marker/list filters are passed in the optional second
object. Purge callers own human confirmation and must authorize each resolved index row; unavailable
domains remain `adapter-unavailable` after authorization even when their entity policy denies them.
