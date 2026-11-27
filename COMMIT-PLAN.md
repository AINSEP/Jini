# Commit plan — w3-p4mounts (Jini only)

Base: `fd06f45b12ae0516b0fc196f58d785eba4d3831e` (`codex/w3-p4mountsj`). All changes remain in the working tree. No commits, pushes, subagents, tests, builds, installs, type-checks or linters ran.

## 1. J0 — Preserve an Express host’s error routing in reporter mode

Implemented, awaiting Opus review/execution. Wrote the two named characterization tests in each reporter suite before production edits. Existing unopted policy/original-ID, post-header stream-cut and disconnect tests remain.

Files:

- `api-baseline/jini-ai__http-kit.json`
- `packages/http-kit/docs/spec/api.spec.md`
- `packages/http-kit/src/__tests__/adapter-reporter.test.ts`
- `packages/http-kit/src/__tests__/raw-route-reporter.test.ts`
- `packages/http-kit/src/adapter.ts`
- `packages/http-kit/src/raw-route.ts`
- `packages/http-kit/src/types.ts`
- `.changeset/http-kit-preserve-host-error-routing.md`

Mutations for Opus (not executed):

- `swallow-forwarded-policy-error`: replace the post-operation forwarded-value throw with the kit generic reply, independently in JSON/raw. The tests require identity at Express middleware, one ended operation, zero kit records/writes and middleware-selected 422.
- `bypass-host-write-policy`: bypass the opted-in pre-header `onError` dispatch in each transport. The tests require the host’s exact 503/body, one record, one operation and one handle invocation. Raw fails while buffering, before headers.

The option is opt-in `true` only; omitted retains legacy/unopted behavior. Both internal option picks include it. No export-map change. Only the `RouteMountOptions` baseline signature changed: `5486affbd6` → `6bd7ba7c85`. Used the existing local TypeScript AST printer; reproduced the old signature first. No API sweep or compiler check ran.

## 2. J4-F — Remove daemon fixtures’ retiring kit imports

Implemented, awaiting Opus review/execution. Wrote `a fixture-host incident exposes the same ERR id it records and no cause` before adding `createRouteTestErrors`. Repointed all 22 imports/value uses; preserved structured `recordIncident` fixtures, retired-option canaries and independent callbacks. Mounted defaults reuse context ownership or bind one recording context. The attachment fixture’s existing default-sink caller assertion also needed conversion in `attachments.test.ts`.

Files:

- `packages/daemon/src/http/__tests__/args-convention.test.ts`
- `packages/daemon/src/http/__tests__/attachments.test.ts`
- `packages/daemon/src/http/__tests__/connectors.test.ts`
- `packages/daemon/src/http/__tests__/daemon-status.test.ts`
- `packages/daemon/src/http/__tests__/db-ops.test.ts`
- `packages/daemon/src/http/__tests__/delegated-tools-host-described-internal-error.test.ts`
- `packages/daemon/src/http/__tests__/delegated-tools-host-safe-failure.test.ts`
- `packages/daemon/src/http/__tests__/delegated-tools-status-mapping.test.ts`
- `packages/daemon/src/http/__tests__/delegated-tools.obtain-from.integration.test.ts`
- `packages/daemon/src/http/__tests__/delegated-tools.test.ts`
- `packages/daemon/src/http/__tests__/delegated-tools.unknown-tool.integration.test.ts`
- `packages/daemon/src/http/__tests__/fakes/mount-attachments.ts`
- `packages/daemon/src/http/__tests__/fakes/route-host.ts`
- `packages/daemon/src/http/__tests__/frontend-control.test.ts`
- `packages/daemon/src/http/__tests__/integration-contracts.test.ts`
- `packages/daemon/src/http/__tests__/media.test.ts`
- `packages/daemon/src/http/__tests__/remote-run-events.test.ts`
- `packages/daemon/src/http/__tests__/research-handle.test.ts`
- `packages/daemon/src/http/__tests__/research-ports.test.ts`
- `packages/daemon/src/http/__tests__/research.test.ts`
- `packages/daemon/src/http/__tests__/route-incident-reporter.test.ts`
- `packages/daemon/src/http/__tests__/run-messages.test.ts`
- `packages/daemon/src/http/__tests__/runs.test.ts`
- `packages/daemon/src/http/__tests__/terminals.test.ts`
- `packages/daemon/src/http/__tests__/tool-execution-rpc.test.ts`
- `packages/daemon/src/http/runs.ts`
- `packages/daemon/src/http/terminals.ts`

Mutation for Opus (not executed): `fixture-uses-second-id` changes only the fixture binding’s returned `requestId`. The new mounted test compares response ID with the sole entry’s `meta.errorId` and sole report’s `incidentId`, and excludes a private canary from the response.

No daemon baseline/export/changeset edits; `.changeset/daemon-route-tool-reporter.md` remains intact.

## Left

- J3a: STOP/held. Requires reviewed paired T-GATE; no such evidence supplied. No breaking retirement edits applied.
- J3b: STOP/held. Requires J3a, T-GATE and paired Tovu bindings.
- T0, A1–A8, P, R1–R3, T-GATE: Tovu scope, left for its builder.
- No Jini sheet here is labelled OPUS-only/NEEDS-OPUS/REJECT. J0/J4-F require Opus review.

## Review evidence and handoff

Source test declarations across 25 changed suites: 750 → 755 (parameterized rows unexpanded). No test removed/skipped and no coverage configuration changed. Runtime/mutation results are unverified by dispatch instruction. `rg -n -w reportRouteInternalError packages/daemon/src/http` returned no matches, exit 1.

Static architecture audit: transport-only choice; no core or production daemon behavior changed. Function review: JSON/raw policy-forwarding and write dispatch, recording fixture and mounted defaults remain small with direct test seams; no new abstraction/helper beyond the named fixture. Runtime proof, strict checks and applicable guards remain Opus work.

Documentation: option documented in the named spec; injected-owner comments updated. New test-only fixture is intentionally uncommented under the owner’s no-new-comments rule.

Final diff cleanup: removed unused legacy imports, obsolete default-console assertions and their obsolete connector/attachment fixture comments; replaced them with correlated recording assertions. Removed redundant narrowing/assertions and temporary extra raw helper generics. No files or production branches deleted.

Tovu needs no new subpath/export: use the existing root `RouteMountOptions` option through T0’s conditional `preserveHostErrorRouting: true` plumbing. Keep J3a/J3b held until T-GATE is reviewed.
