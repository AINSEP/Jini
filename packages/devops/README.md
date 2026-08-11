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

Deployment stays independent from CI/CD: a pipeline may invoke a deployment,
but the two have different credentials, approval policies, lifecycle, and audit
requirements.
