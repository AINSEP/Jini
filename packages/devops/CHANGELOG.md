# @jini-ai/devops

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
