# @jini-ai/devops

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
