# `@jini-ai/devops`

DevOps capabilities are intentionally separate from application capability
providers such as auth, storage, and payments. Each capability has its own
public subpath and permission boundary.

## Entry points

| subpath | purpose |
|---|---|
| `./deploy` | The generic deploy seam: the `DeployTarget` port, the `DeployTargetToken` many-token, the guarded `deploy.publish` tool, and the `DeployTargetModule`/`DeployHostKit` contract. Ships no hosting vendor. |
| `./source-control` | Reserved for repository, branch, commit, and pull-request operations. |
| `./ci-cd` | Reserved for pipeline definitions, run status, logs, cancellation, and deployment orchestration. |

```ts
import {
  DeployTargetToken,
  createDeployPublishToolRegistration,
} from '@jini-ai/devops/deploy';
```

Hosting targets live in the host, not in this package: the host writes each
target as a `DeployTargetModule` and hands it a `DeployHostKit` (the outbound
`fetch`, timeouts, and this package's naming, reachability and redirect-guard
helpers), so the module needs no imports of its own. `create()` returns a plain
`DeployTarget`. `DeployPublishInput.responseHeaders` carries the headers every
published page should be served with; each target renders them its own way.

Deployment stays independent from CI/CD: a pipeline may invoke a deployment,
but the two have different credentials, approval policies, lifecycle, and audit
requirements.
