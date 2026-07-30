# `@jini-ai/deploy`

Publish a set of files as a static site to Vercel, Cloudflare Pages, Netlify, or GitHub Pages through
one interface. Every provider is a `DeployTarget` — same `publish(input)` call, same
`DeployPublishResult`, same `DeployError` on failure — so a host binds whichever targets it has
credentials for and lets the caller pick by id at runtime. It also handles the part that usually gets
skipped: waiting for the freshly deployed URL to actually respond, and telling a protected/SSO-gated
deployment apart from a broken one.

## Install

```sh
npm install @jini-ai/deploy
```

No peer dependencies. `@jini-ai/core`, `@jini-ai/platform`, and `undici` are regular dependencies,
installed automatically. Nothing here needs a native compile.

## What you get

**The port and its vocabulary** — `DeployTarget`, `DeployFile`, `DeployPublishInput`,
`DeployPublishResult`, `DeployError` / `DeployErrorDetails`, `DeploymentUrlCheck`, `DeployLinkStatus`
(`'ready' | 'protected' | 'failed' | 'link-delayed'`).

**Four provider targets**, each a class taking only its own config object:
- `VercelDeployTarget` / `VercelDeployConfig` (`token`, optional `teamId`/`teamSlug`), plus
  `isVercelProtectedResponse` for detecting Vercel's Deployment Protection auth wall, and
  `VERCEL_TARGET_ID`.
- `CloudflarePagesDeployTarget` / `CloudflarePagesDeployConfig`, the richest of the four: asset
  hashing (`cloudflarePagesAssetHash`), upload batching (`chunkCloudflarePagesAssetUploads` against
  the documented `CLOUDFLARE_PAGES_ASSET_UPLOAD_MAX_FILES` / `..._MAX_BODY_BYTES` /
  `CLOUDFLARE_PAGES_ASSET_MAX_BYTES` limits), custom-domain selection
  (`CloudflarePagesCustomDomainSelection`, `CloudflarePagesPriorCustomDomainMetadata`,
  `listCloudflarePagesZones`), and `CloudflarePagesPublishMetadata`.
- `NetlifyDeployTarget` / `NetlifyDeployConfig` and `NETLIFY_TARGET_ID`.
- `GitHubPagesDeployTarget` / `GitHubPagesDeployConfig` and `GITHUB_PAGES_TARGET_ID`.

**Reachability probing** — `normalizeDeploymentUrl`, `checkDeploymentUrl`,
`waitForReachableDeploymentUrl` with `ReachabilityOptions` / `ReachabilityWaitOptions` /
`ReachabilityWaitResult`, and the injectable `ProtectedResponseDetector` seam.

**Naming** — `safeProjectLabel(raw, maxLength)` and `safeDnsLabel(raw)`, for turning arbitrary
user-supplied project names into something a provider and DNS will accept.

**Composition** — `DeployTargetToken` (a `manyToken`, so several targets bind at once) and
`publishDeploy(input, targets)`, which picks the target matching `input.targetId` and throws a 404
`DeployError` if none does.

**Tool registration** — `DEPLOY_PUBLISH_TOOL_ID` (`'deploy.publish'`),
`createDeployPublishToolRegistration(options)`, and two policies:
`denyAllDeployPublishPolicy` (the safe default) and
`createRoleGatedDeployPublishPolicy(...)` gating on `DEFAULT_DEPLOY_PUBLISH_ROLE`
(`'deploy:publish'`). Publishing to the public internet is a privileged action, so the shipped
default refuses and a host must opt in explicitly.

## Usage

```ts
import { bindings, createDaemon, definePack } from '@jini-ai/core';
import {
  DeployTargetToken,
  NetlifyDeployTarget,
  VercelDeployTarget,
  publishDeploy,
  safeDnsLabel,
  waitForReachableDeploymentUrl,
  type DeployFile,
} from '@jini-ai/deploy';

const targets = [
  new VercelDeployTarget({ token: process.env.VERCEL_TOKEN! }),
  new NetlifyDeployTarget({ token: process.env.NETLIFY_TOKEN! }),
];

const files: DeployFile[] = [
  { file: 'index.html', data: Buffer.from('<!doctype html><h1>hi</h1>') },
];

const result = await publishDeploy(
  { targetId: 'vercel', files, projectName: safeDnsLabel('My Landing Page') },
  targets,
);

const reachable = await waitForReachableDeploymentUrl([result.url], { timeoutMs: 60_000 });
if (reachable.status === 'protected') {
  // Deployed fine, but behind the provider's own SSO gate — not a failure.
}

// Or bind them for a pack to resolve — bindMany takes one impl per call, so chain it:
const bound = bindings().bindMany(DeployTargetToken, targets[0]).bindMany(DeployTargetToken, targets[1]);
const deployPack = definePack({
  name: 'deploy',
  deps: [DeployTargetToken],
  services: (c) => ({ targets: c.getMany(DeployTargetToken) }),
});
const daemon = createDaemon({ packs: [deployPack] as const, bindings: bound });
```

Check `DeployFile` and `DeployPublishResult` in `src/types.ts` for the exact field sets before wiring
a real build output through.

## What's swappable

`DeployTarget` is the port — implement it for any provider (Fly, S3+CloudFront, an internal CDN) and
`publishDeploy` routes to it by id with nothing else changed. `DeployTargetToken` being a `manyToken`
means a host binds as many as it has credentials for rather than choosing one at build time. On the
reachability side, `ProtectedResponseDetector` is injectable, so a provider with its own auth-wall
shape does not need a change here. `ToolPolicy` is yours to supply at registration. The four shipped
targets' HTTP call sequences and the Cloudflare batching limits are fixed — they track what those
providers' APIs actually require.

## Runtime

`jini.runtime: "node"` — HTTP via `undici`, `node:crypto` for asset hashing, `Buffer` for file data.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
