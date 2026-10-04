# @jini-ai/devops

## 0.5.1 — 2026-10-04

- `@jini-ai/devops/local-dev` exports `listenServer`.
- Internal `@jini-ai/*` dependencies are caret ranges (`workspace:^`) instead of exact pins, so a host on a newer patch resolves a single copy without an override.

## 0.5.0 — 2026-10-02

### BREAKING

- Published source-control, deployment, static-export and packaging targets use concept paths. Clock-only sleeping uses SleepPort and HTTP contracts use core; Node deployment guards are isolated in ./deploy/node.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- BREAKING: reachability requires a paired `guard` and `fetch`. Move concrete URL/DNS/undici wiring and `lookupImpl` overrides to new `./deploy/node` default adapter `createNodeReachabilityPorts`; existing probe and polling budgets remain.

### Added

- `./source-control`: trusted provider catalog, provider kit, repository validation,
  preview and credentialed commit orchestration with isolated artifact cleanup.
- `./static-export` and `./static-export/node`: injected manifest/app/asset/export
  orchestration and explicit loopback, writer and theme-inventory Node adapters.
- `./packaging/electron` and `./packaging/electron/typescript`: dependency staging,
  archive byte verification, reachable-import and stability policies; host-bound
  archive/parser/packer adapters. TypeScript is an optional peer.
- `./agent-jobs`: bounded, resumable CLI jobs with host-supplied execution and
  filesystem ports, stream-based completion and retained raw logs.
- Package integration, object-fetch adapter and whole-source neutrality contracts.

### Fixed

- Compilation: published-type checks sort copies of readonly directory listings;
  deployment integration tests use the daemon executor's object arguments. The
  Node reachability adapter attaches its validating Agent at runtime without
  intersecting incompatible Node and undici dispatcher types.
- `./agent-jobs`: resume only from regular report files (following file symlinks).
  Final-artifact write/removal failures fail the affected job and leave the pool scheduling.
- `./packaging/electron`: native-magic inspection reads at most four bytes per file
  through a bounded `readPrefix` filesystem port. Custom npm staging adapters must
  supply this capability; no whole-file fallback is allowed. Other packaging adapters
  retain their existing shape. Node descriptor cleanup includes read failures.
- Regression tests cover resume, each final-artifact persistence failure, sparse/short
  prefix reads and missing-capability refusal. Verification deferred by owner directive.

### Breaking

- Source directories now name their capabilities: `source-control`, `static-export`,
  `deploy`, `packaging/electron` and `agent-jobs`. All package export keys are retained;
  only source/output targets move. Internal job-path imports are removed.
- `./packaging/electron`: rename the delay-only `ClockPort` type to `SleepPort`;
  its method and the `observeMovingPaths` argument shape remain unchanged.
- `./deploy`: rename the loose `JsonObject` type to `UnknownRecord`, retaining
  `Record<string, unknown>` rather than tightening provider metadata/config values.
- `./source-control`: adopt core/primitives' canonical `HttpClientPort` without a
  local declaration. `send({ request }, { redirect })` replaces `send(request)`;
  import `HttpRequest`/`HttpResponse` from core in place of the removed
  `SourceControlHttpRequest`/`SourceControlHttpResponse` declarations.

- `./deploy`: helpers, factories, `DeployError` construction and deploy/host/SigV4
  port methods now take required argument objects followed by optional argument
  objects. Publish metadata/response headers and registration options move to
  the second object. Reachability requires object-argument fetch; polling also
  requires object-argument clock/delay ports. Protected-response detectors take
  `{ resp, body }`. Export names are retained; no positional adapter is supplied.
- The newly extracted source-control and static-export fetch dependencies also
  take `({ url }, { init })`. Host-selected native fetch is bound through
  `createSourceControlFetchAdapter({ fetch })` or `createExportFetchAdapter({ fetch })`.

### Additional checks

- `./checks/published-types`: registry drift, published typecheck, linked-package checks,
  and captured-log diagnosis with explicit filesystem, runner, installer and project ports.
- `./local-dev`: environment-file loading and listener parsing/lookup with host-supplied paths and commands.
- `./checks/coverage`: LCOV parsing, contamination/baseline evaluation, aggregate and two-tier floors,
  disk-inventory gap ratchets, and runner/glob drift policies with caller-supplied roots and classifiers.
- `./checks/node`: optional Node filesystem/environment/process and npm executable adapters.
- Generalized regression suites and a consumer-reference guard. Verification deferred by owner directive.

## 0.4.0

### Breaking

- `./deploy`: the four hosting-vendor targets are removed, with their constants
  and helpers: `VercelDeployTarget`, `NetlifyDeployTarget`,
  `CloudflarePagesDeployTarget`, `GitHubPagesDeployTarget`, `*_TARGET_ID`,
  `CLOUDFLARE_PAGES_ASSET_*`, `isVercelProtectedResponse`,
  `chunkCloudflarePagesAssetUploads`, `cloudflarePagesAssetHash`,
  `listCloudflarePagesZones` and their config/metadata types. A host now
  supplies its own targets as `DeployTargetModule`s built on `DeployHostKit`.
- `deploy.publish`'s tool description no longer names any provider.

### Unchanged

- `DeployTarget`, `DeployTargetToken`, `publishDeploy`, `deploy.publish`
  (`createDeployPublishToolRegistration` and its policies), the host-kit types,
  and the naming, reachability and redirect-guard helpers.

### Added

- A guard test that fails if a hosting-vendor name appears anywhere under
  `packages/devops/src`.

## 0.3.3

### Added

- `./deploy`: `DeployPublishInput.responseHeaders` (`ResponseHeaderSet`), the header
  set a caller wants every published page served with; each target renders it
  into its own host format or ignores it.
- `./deploy`: the injection contract for host-supplied targets:
  `DeployTargetModule` (`create({ credential, config, kit })` returning a
  `DeployTarget`, plus optional `validateConfig`, `basePath`,
  `verifyCredential`) and `DeployHostKit` (timed `fetch`, timeouts, `sleep`,
  reachability, naming and redirect-guard helpers, a SigV4 client factory,
  `DeployError`), with their context and result types. Type-only; additive.

## Earlier

### Added

- `./deploy`: deploy targets for Vercel, Cloudflare Pages, Netlify, and GitHub
  Pages, plus typed DI composition, guarded `deploy.publish`, naming, and
  reachability checks.
