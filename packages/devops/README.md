# `@jini-ai/devops`

DevOps capabilities are intentionally separate from application capability
providers such as auth, storage, and payments. Each capability has its own
public subpath and permission boundary.

## Entry points

| subpath | purpose |
|---|---|
| `./deploy` | Publish sites to Vercel, Cloudflare Pages, Netlify, or GitHub Pages through `DeployTarget`; includes the guarded `deploy.publish` tool. |
| `./source-control` | Reserved for repository, branch, commit, and pull-request operations. |
| `./ci-cd` | Reserved for pipeline definitions, run status, logs, cancellation, and deployment orchestration. |

```ts
import {
  DeployTargetToken,
  VercelDeployTarget,
} from '@jini-ai/devops/deploy';
```

A host can also keep its own target code outside this package: it writes each
target as a `DeployTargetModule` and hands it a `DeployHostKit` (the outbound
`fetch`, timeouts, and this package's naming, reachability and redirect-guard
helpers), so the module needs no imports of its own. `create()` returns a plain
`DeployTarget`. `DeployPublishInput.responseHeaders` carries the headers every
published page should be served with; each target renders them its own way.

Deployment stays independent from CI/CD: a pipeline may invoke a deployment,
but the two have different credentials, approval policies, lifecycle, and audit
requirements.
