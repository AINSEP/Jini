# `@jini-ai/devops`

DevOps capabilities are intentionally separate from application capability
providers such as auth, storage, and payments. Each capability has its own
public subpath and permission boundary.

## Entry points

| subpath | purpose |
|---|---|
| `./deploy` | The generic deploy seam: the `DeployTarget` port, the `DeployTargetToken` many-token, the guarded `deploy.publish` tool, and the `DeployTargetModule`/`DeployHostKit` contract. Ships no hosting vendor. |
| `./source-control` | Trusted provider catalogs, repository validation, export preview and commit orchestration. |
| `./static-export` | Manifest/app/writer-driven static export, path transforms and route/asset failure summaries. |
| `./static-export/node` | Explicit Node loopback app, artifact writer and theme-file inventory adapters. |
| `./packaging/electron` | Dependency staging, archive byte verification, reachable-import, freshness and quiet-tree policies. |
| `./packaging/electron/typescript` | Host-supplied TypeScript AST adapter; TypeScript is an optional peer. |
| `./agent-jobs` | Bounded CLI jobs with resume, stdin prompts, raw logs and stream-based completion. |
| `./checks/published-types` | Published type-surface, registry-drift, linked-package and captured-log checks. |
| `./checks/coverage` | LCOV, floor, diff, disk-inventory and contamination/baseline policies. |
| `./checks/node` | Explicit filesystem, process, environment-loader and installer adapters. |
| `./local-dev` | Environment-file and listener lookup helpers with host-supplied paths/commands. |
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
`DeployTarget`. `DeployPublishOptions.responseHeaders` carries the headers every
published page should be served with; each target renders them its own way.

Public helpers and ports accept required argument objects followed by optional
argument objects. For example:

```ts
const registration = createDeployPublishToolRegistration(
  { targets },
  { policy, timeoutMs: 30_000 },
);
await target.publish({ files, projectName }, { responseHeaders });
```

Reachability requires a transport port with `fetch({ url }, { init })`. Polling
also requires `now({})` and `sleep({ ms })` ports. See
[API.md](https://github.com/AINSEP/Jini/blob/main/packages/devops/API.md) for the current port contracts.

Deployment stays independent from CI/CD: a pipeline may invoke a deployment,
but the two have different credentials, approval policies, lifecycle, and audit
requirements.

The root entry stays a domain marker. Import individual capabilities from their
subpaths; filesystem/process/archive port names are local to their capability.
See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/devops/API.md) for composition examples and port requirements. No helper
selects an application root, credential name or plugin descriptor filename for
the caller. Targets/ops/static-publish registries remain a separate extraction
design; only the generic `./deploy` seam ships here today.

Source control uses `HttpClientPort` from `@jini-ai/core/primitives`; the kit
passes the host's guarded client through unchanged. Packaging's delay-only port
is `SleepPort`. Deploy provider option bags use `UnknownRecord`, whose values
remain `unknown` rather than being restricted to JSON values. Public subpath
keys stay stable when source directories move.

## Deployment outbound policy

Reachability now requires `{ url, fetch, guard }` (polling also requires clock/sleep).
`DeploymentUrlGuard.assertSafeUrl({ raw, label })` supplies synchronous URL policy;
the paired fetch port MUST enforce DNS policy at connection time. A separate DNS
preflight is insufficient because it allows rebinding before the socket connects.
The deploy core imports neither platform nor undici.

```ts
import { checkDeploymentUrl } from '@jini-ai/devops/deploy';
import { createNodeReachabilityPorts } from '@jini-ai/devops/deploy/node';
const ports = createNodeReachabilityPorts({});
await checkDeploymentUrl({ url: 'https://example.com', ...ports });
```

The Node defaults reject unsafe public URLs and pin validation to the connection
through platform's validating lookup. `lookupImpl` overrides move from probe
options to `createNodeReachabilityPorts({}, { lookupImpl?, fetch? })`.
Default dispatchers remain shared; each override binding retains its own lazy
pool. HTTPS-only probes, manual redirects and existing deadlines are preserved.
The Node adapter attaches the validating Agent as a native fetch runtime extension,
preserving its identity across differing Node and undici dispatcher type versions.
