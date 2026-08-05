# `@jini/deploy` — provenance

Origin: `nexu-io/open-design` (fork `leonaburime-ucla/open-design`), local reference clone
`/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic`, `apps/daemon/src/deploy.ts`
(2,005 lines, read in full; not modified).

Per `ADS-memory/reports/jini-port/extraction-plan.md` §10 (roadmap appendix): "`@jini/deploy` — Netlify /
Vercel / GitHub Pages deploy targets (multi-bound `DeployTarget` token; `deploy.publish` is a
Tool)." This is a **new package, not one of the locked §3 set** — it was only named in the
roadmap-appendix prose, so per the Programmer dispatch it is added to `AGENTS.md`'s package list
flagged as needing Coordinator/Software-Architect sign-off before it is treated as locked
architecture, same as any other genuinely new package would be.

## Package map

| Jini file | Origin file(s)/section | Transform |
|---|---|---|
| `src/types.ts` | `deploy.ts` lines 14-73 (`DeployFile`, `DeployFilePlan`, `DeployOptions`, `DeploymentUrlCheck`, `DeployLinkStatus`, `DeployError`) | Kept `DeployFile`, `DeployLinkStatus`, `DeploymentUrlCheck`, `DeployError` as the provider-agnostic shapes the task called for. Replaced the OD-shaped `DeployConfig`/`DeployOptions`/`DeployFilePlan` (which carried `teamId`/`accountId`/`cloudflarePages` hints and OD's `metadata`/`includeProjectFiles` project-model options) with a single generic `DeployPublishInput { files, projectName, metadata? }` and `DeployPublishResult { targetId, url, deploymentId?, status, statusMessage?, reachableAt?, providerMetadata? }`. Added the `DeployTarget` port interface (`publish`, `checkReachability`) — this did not exist in the origin file, which had two free functions (`deployToVercel`, `deployToCloudflarePages`) instead of a shared interface; extraction-plan.md §10 calls for a real port so Vercel/Cloudflare/future targets are interchangeable behind one contract. |
| `src/naming.ts` | `deploy.ts` lines 1988-2005 (`safeVercelProjectName`, `safeDnsLabel`, `safeProjectLabel`) | `safeProjectLabel` lifted verbatim (pure string sanitizer, no OD dependency). `safeDnsLabel` lifted verbatim. `safeVercelProjectName` moved into `vercel.ts` (it's Vercel-specific — see below). |
| `src/reachability.ts` | `deploy.ts` lines 1661-1797 (`waitForReachableDeploymentUrl`, `checkDeploymentUrl`, `requestDeploymentUrl`, `normalizeDeploymentUrl`) | Logic lifted verbatim. Genericized the Vercel-specific protected-response check: the origin hardcoded `isVercelProtectedResponse` inside this shared reachability code; here it's a caller-supplied `detectProtected`/`protectedMessage` option on `ReachabilityOptions`/`ReachabilityWaitOptions`, so Cloudflare/future targets aren't forced to carry Vercel's SSO-cookie sniffing. `deploymentUrlCandidates` stayed in `vercel.ts` since only Vercel's alias-array response shape needs it. |
| `src/vercel.ts` | `deploy.ts` lines 9, 52, 59-60, 76-94 (config path only, dropped), 112-126 (dropped), 161-170, 198-205 (dropped), 388-437 (`deployToVercel`), 1645-1659 (`pollVercelDeployment`), 1765-1776 (`isVercelProtectedResponse`), 1800-1805 (`vercelTeamQuery`), 1896-1937 (`readVercelJson`/`vercelError`), 1939-1943 (`deploymentUrl`), 1778-1791 (`deploymentUrlCandidates`), 1988-1990 (`safeVercelProjectName`) | `deployToVercel`'s HTTP flow (create deployment, poll, resolve URL, reachability wait) ported as `VercelDeployTarget.publish`. **Dropped:** `readVercelConfig`/`writeVercelConfig`/`deployConfigPath`/`publicDeployConfig`/`SAVED_TOKEN_MASK` — this was OD's own persisted-config-file convention (`~/.open-design/vercel.json`, `OD_USER_STATE_DIR`), i.e. exactly the kind of caller-owned concern the task called out for dropping; a caller now constructs `new VercelDeployTarget({ token, teamId?, teamSlug? })` directly and owns wherever it persists that config. Deployment naming: `od-${projectId}` → `safeVercelProjectName(input.projectName)` (still sanitized/length-capped, no OD prefix, no `projectId`). |
| `src/cloudflare-pages.ts` | `deploy.ts` lines 10, 25-29, 53-58, 96-149 (config path, dropped), 172-186 (dropped), 439-1017 (zones/project/upload-token/asset-upload/deploy), 1019-1329 (`aggregateCloudflarePagesStatus` + full custom-domain/DNS-record flow), 1831-1837 (`cloudflarePagesProjectNameForProject`), 1955-1986 (hostname/zone-name/marker/hash helpers) | The full deploy + DNS/custom-domain feature ported as `CloudflarePagesDeployTarget.publish` (core deploy) and a private `setupCloudflarePagesCustomDomain` helper invoked when `input.metadata.customDomain` is supplied. **Dropped:** `readCloudflarePagesConfig`/`writeCloudflarePagesConfig`/`CloudflarePagesConfigHints` persistence (same OD-file-convention reasoning as Vercel) — caller supplies `{ token, accountId }` directly. **Genericized:** `cloudflarePagesProjectNameForProject(projectId, projectName)` (which mixed OD's `projectId` into the Pages project name so re-publishing the same OD project stayed idempotent) → `deriveCloudflarePagesProjectName(projectName)`, deterministic from `input.projectName` alone — the caller's own stable label is now the idempotency key, since this package has no `projectId`. The DNS-record comment marker `od:cfp:${hash}:${hash}` → `jini-deploy:${hash}:${hash}` (same mechanism — a stable stamp so a later publish recognizes a CNAME it created itself — just without the OD string). `cloudflarePagesProviderMetadata`'s `projectId`-keyed shape folded into `providerMetadata.customDomain` without a `projectId` field (the caller already has its own id space; this package doesn't need to round-trip one). **Dependency swap:** `cloudflarePagesAssetHash`/`shortCloudflareHash` used `blake3-wasm` purely as a deterministic content-addressing function for Cloudflare's direct-upload protocol (which only needs a stable, collision-resistant key per asset — the specific algorithm is not part of Cloudflare's contract). Swapped to Node's built-in `crypto.createHash('sha256')` (same output shape: lowercase hex, sliced to the same lengths) so this package adds no native/WASM dependency to the engine's dependency graph. |
| `src/tokens.ts` | *(new — no direct origin)* | `DeployTargetToken = manyToken<DeployTarget>('jini.deployTarget')`, matching extraction-plan.md §2.2's own worked example verbatim (`bindMany(DeployTarget, netlifyTarget)`). `publishDeploy(input, targets)` is `deploy.publish` shaped as a **plain async function** today — dispatches to whichever bound `DeployTarget` matches `input.targetId`. See "Deferred: ToolExecutor wiring" below. |
| `src/index.ts` | *(new — barrel)* | Re-exports all of the above. |

## Dropped entirely (not ported, no analog needed)

The origin file's `buildDeployFilePlan`/`buildDeployFileSet`/`addVisibleProjectFilesToDeployPlan`/
`isLinkedFolderProject` (lines 241-386) and the whole HTML/CSS reference-walking family that only
existed to support them — `extractHtmlReferences`, `extractCssReferences`,
`extractInlineCssReferences`, `rewriteEntryHtmlReferences`, `rewriteCssReferences`,
`resolveReferencedPath`, `rewriteHtmlReference`, `rewriteSrcset`, `parseHtmlTags`,
`parseHtmlAttributes`, `rewriteHtmlAttributes`, `shouldCollectHref`, `htmlRawTextRanges`,
`isOffsetInRanges`, `referenceSuffix`, `injectDeployHookScript`, `normalizeDeployHookScriptUrl`,
`escapeHtmlAttribute` (lines 236-341, 1161-1288, 1482-1514, 1516-1527) — and the preflight
warnings helper `analyzeDeployPlan`/`prepareDeployPreflight` (lines 1289-1480) that consumed their
output.

**Why:** this entire family exists to walk *OD's own project file tree* (via `readProjectFile`/
`listFiles`/`validateProjectPath` from `./projects.js`) starting from a single HTML entry point,
discover every referenced asset, and rewrite in-document paths so the result works once flattened
to a deploy root. The task is explicit that `@jini/deploy` "does NOT know about 'projects,' it
just takes a file set" — the caller resolves and hands over a complete, already-correct
`DeployFile[]`. With no project tree to walk, there is nothing left for this code to do; a caller
building its own file set already owns path resolution/rewriting in whatever shape its own file
model uses. If a future consumer wants a reusable "flatten an HTML entry + its referenced assets
into a deploy-ready file set" utility, that is a separate, standalone package (it has zero
dependency on Vercel/Cloudflare/the `DeployTarget` port) — flagged as a possible future
`@jini/deploy-html-plan` or similar, not part of this package.

Also dropped: `isDeployProviderId`, `publicDeployConfigForProvider`, `readDeployConfig`,
`writeDeployConfig`, `VERCEL_PROVIDER_ID`/`CLOUDFLARE_PAGES_PROVIDER_ID` as a closed
`DeployProviderId` union — superseded by `DeployTarget.id: string` (open-ended, so a third target
doesn't require a union edit) and `VERCEL_TARGET_ID`/`CLOUDFLARE_PAGES_TARGET_ID` string constants.

## `deploy.publish` as a Tool (historical — built 2026-07-21, see the dated section below)

Per the original dispatch: `@jini/core`'s `ToolRegistry`/`ToolExecutor` boundary
(extraction-plan.md §2.5, §8 task 6) did not exist yet at the time this package was first ported.
`publishDeploy` in `tokens.ts` was a plain async function a pack's app-service could call
directly, with the intended future shape sketched inline as a comment. Task 6 has since landed
(`@jini/core`'s `tool-registry.ts` + `@jini/daemon`'s `tool-executor.ts`) and the sketch below is
now real, built code — see "## 2026-07-21 addition — `deploy.publish` wired as a real Tool
(`src/tool.ts`)" further down for what actually shipped and how it differs from this sketch:

```ts
toolRegistry.register({
  descriptor: { id: 'deploy.publish', /* input/output schema */ },
  handler: (principal, run, input, signal) => publishDeploy(input, targets),
  policy: { /* e.g. requires confirmation before an external publish */ },
});
```

so callers reach it only via `ToolExecutor.execute(principal, run, 'deploy.publish', input,
signal)` — never a direct handler reference, per the tool-execution boundary's anti-bypass rule
(§2.5). `publishDeploy` itself is unchanged by this — it's still the plain function; `src/tool.ts`
wraps it rather than replacing it.

## Explicitly deferred (not in this task's scope)

- ~~**Real `ToolRegistry`/`ToolExecutor` wiring**~~ — done, see the 2026-07-21 dated section below.
- ~~**GitHub Pages target**~~ — done, see the "`GitHubPagesDeployTarget`" 2026-07-21 dated section
  further down. `deploy.ts` never implemented it (only `vercel-self` and `cloudflare-pages` exist
  in the origin) — this is new work, not a port.
- **Netlify target** — named in extraction-plan.md §2.2's example code (`netlifyTarget`) but,
  like GitHub Pages, has no implementation in the OD origin to port from.
- **The "flatten an HTML entry into a deploy file set" utility** — see "Dropped entirely" above.

## Vocabulary / boundary notes

- No `projectId`, `readProjectFile`, `listFiles`, or `validateProjectPath` anywhere in this
  package — verified by grep (see Programmer handoff report).
- No `Open Design`/`OD_`/`--od-stamp`/`/tmp/open-design` strings — the only "OD" mentions in
  `src/**` are provenance comments describing what was genericized (matching the existing
  convention in `packages/chat-core/src/*.ts` and `packages/daemon/src/*.ts`), not runtime
  identifiers or behavior.
- `DeployTarget` bound as a many-token (`jini.deployTarget`), matching the vocabulary firewall in
  root `AGENTS.md`/extraction-plan.md §12 C5: this is an engine-owned `Tool`-shaped capability
  (`Run`/`Agent`/`Tool` vocabulary), not an automation-domain `PipelineRun`/`WorkItem`.

## 2026-07-21 addition — `deploy.publish` wired as a real Tool (`src/tool.ts`)

Closes the gap the "historical" section above describes: `@jini/core`'s `ToolRegistry`
(`packages/core/src/tool-registry.ts`) and `@jini/daemon`'s `ToolExecutor`
(`packages/daemon/src/tool-executor.ts`) both exist now, and `packages/daemon/src/
delegated-tool-bridge.ts` is the established, already-shipped example of wiring a capability into
that boundary. This addition is the same shape, for `deploy.publish` instead of the delegated-tool
protocol bridge.

| Jini file | Origin | Transform |
|---|---|---|
| `src/tool.ts` | *(new — no OD origin; new design work, same category as `tool-executor.ts` itself)* | `createDeployPublishToolRegistration(options)` builds a `{descriptor, handler, policy}` `ToolRegistration` (the exact shape `@jini/core`'s `ToolRegistry.register` expects) that wraps the existing `publishDeploy`/`DeployTarget[]` machinery in `tokens.ts` — `tokens.ts` itself is untouched. `denyAllDeployPublishPolicy` and `createRoleGatedDeployPublishPolicy` are the two `ToolPolicy` implementations this file ships. |

**What was built:**

- `DEPLOY_PUBLISH_TOOL_ID = 'deploy.publish'` — the registry id.
- `createDeployPublishToolRegistration({ targets, policy?, requiresConfirmation?, timeoutMs? })` —
  returns a `ToolRegistration` a host passes straight to `ToolRegistry.register(...)`. The
  `handler` casts `ToolExecutionContext.input` (typed `unknown` by `@jini/core`'s own boundary
  design) back to `DeployPublishToolInput` and calls the existing `publishDeploy(input, targets)`
  — no duplicated dispatch logic, `tokens.ts`'s `publishDeploy` is still the single place that
  matches `targetId` against the bound `DeployTarget[]`.
- `denyAllDeployPublishPolicy: ToolPolicy` — `authorize()` returns `'deny'` unconditionally. This
  is `createDeployPublishToolRegistration`'s **default** when a caller omits `policy` entirely.
- `createRoleGatedDeployPublishPolicy(allowedRoles = [DEFAULT_DEPLOY_PUBLISH_ROLE])` — a usable,
  non-permissive `ToolPolicy` a host can opt into: allows only a `Principal` whose `roles` array
  contains one of `allowedRoles`. A `Principal` with `roles` undefined or `[]` is denied, not
  waved through.
- Both re-exported from `src/index.ts`'s existing barrel (`export * from './tool.js'`), alongside
  everything else this package exports.

**Authorization policy decision, and why deny-by-default (not e.g. "allow by default" or a
narrower partial default):** the task explicitly asked for a considered choice, not a guess. The
registration's default is `denyAllDeployPublishPolicy` — every call denied unless a host supplies
its own `policy` (a hand-rolled one, or `createRoleGatedDeployPublishPolicy`). Reasoning:

1. **`deploy.publish` is qualitatively different from every other tool wired into this boundary so
   far.** `echo`/`blocked`/etc. in `delegated-tool-bridge.test.ts` and `tool-executor.test.ts` are
   in-process fakes with no side effects outside the test. `deploy.publish` reaches real external
   infrastructure under the *caller's own cloud account* — `VercelDeployTarget`/
   `CloudflarePagesDeployTarget` (`src/vercel.ts`, `src/cloudflare-pages.ts`) make live HTTP calls
   that spend the operator's provider quota, publish content to a public, internet-reachable URL,
   and (when `metadata.customDomain` is set) create real DNS records. A wrongly-allowed call is
   not cheaply reversible and has an externally visible blast radius — the same category of risk
   `@jini/media`'s `DEFAULT_MEDIA_EXECUTION_POLICY` was hardened against (SEC-RB-010, commit
   `0a9c9c237`, `packages/media/src/policy.ts`), except deploy adds "publicly visible" and
   "mutates DNS" on top of "costly."
2. **This branch's own established discipline is deny-by-default for exactly this class of
   capability.** `0a9c9c237`'s commit message states the precedent directly: `policy.ts` "defaulted
   to enabled/unrestricted and let a request with no model bypass an explicit allowedModels list" —
   fixed to `DEFAULT_MEDIA_EXECUTION_POLICY = { mode: 'disabled' }`, with an omitted/blank field
   denied rather than waved through. `denyAllDeployPublishPolicy` and
   `createRoleGatedDeployPublishPolicy`'s "no roles → deny" branch both follow that same rule:
   omission must never read as permission.
3. **A narrower "allow" default was considered and rejected.** E.g. "allow any authenticated
   principal" (any non-empty `principal.id`) was rejected because `Principal.id` (`packages/core/
   src/principal.ts`) is documented as merely "opaque, stable identity — never assumed to be a
   product user id"; it carries no authorization semantics on its own, so gating on its mere
   presence is not actually a gate. "Allow if `principal.roles` is non-empty" (any role at all) was
   also rejected for the same reason `createAllowlistMediaPolicy`'s model check was hardened —
   *some* role existing says nothing about whether it's the *right* role for a real-money,
   externally-visible action; `createRoleGatedDeployPublishPolicy` requires a specific role
   (default `'deploy:publish'`) instead of merely "any role."
4. **`requiresConfirmation` was deliberately left unset by default**, not forced to `true`. The
   registration already denies-by-default at the policy layer; forcing `requiresConfirmation: true`
   on top would suggest the *only* protection here is an interactive confirmation prompt (skippable
   in a headless host with no `ExecutionDelegate.onConfirm` wired — `tool-executor.ts`'s
   `requestConfirmation` just parks forever with no delegate, or a delegate could set it to always
   confirm). A caller that wants that extra layer sets `requiresConfirmation: true` explicitly via
   `CreateDeployPublishToolRegistrationOptions`.

**Tests:** `src/__tests__/tool.test.ts`, 15 tests, 100%/100%/100%/100% (statements/branches/
functions/lines) on `tool.ts` specifically (`pnpm --dir packages/deploy exec vitest run
--coverage`). Coverage includes, mirroring the proof patterns already established in
`packages/daemon/src/__tests__/tool-executor.test.ts` and `delegated-tool-bridge.test.ts`:

- `denyAllDeployPublishPolicy` denies regardless of principal/input (both a principal with the
  "right" role and one with none — the policy doesn't even look at the principal).
- `createRoleGatedDeployPublishPolicy`: no `roles` field, empty `roles: []`, non-matching role,
  matching default role, and a caller-supplied `allowedRoles` list overriding the default — every
  branch of the `!roles || roles.length === 0` guard and the `.some(...)` membership check.
- `createDeployPublishToolRegistration`: descriptor id/description are set; `requiresConfirmation`/
  `timeoutMs` are genuinely *absent* (not merely `undefined`-valued — `'requiresConfirmation' in
  descriptor` is `false`) when omitted, and present when supplied, proving the
  `exactOptionalPropertyTypes`-driven conditional-spread branches both directions; defaults to
  `denyAllDeployPublishPolicy` by reference when `policy` is omitted; uses a caller-supplied policy
  instead when provided; the handler correctly dispatches through `publishDeploy` to the matching
  bound `DeployTarget`.
- **End-to-end through the real `ToolExecutor`** (`createToolExecutor` from `@jini/daemon`,
  `createToolRegistry` from `@jini/core` — not hand-rolled fakes of either): an unauthorized
  principal under the default policy is denied, the underlying `DeployTarget.publish` is never
  invoked (`target.lastInput` stays `undefined`), and the audit trail is exactly `['requested',
  'denied']` — proving the gate actually blocks the side effect, not just that a function returns
  `'deny'` in isolation. A principal with a non-matching role is denied the same way under
  `createRoleGatedDeployPublishPolicy`. A principal with the required role is allowed, the target's
  `publish` actually runs and returns its real result through `ToolExecutor`, and the audit trail
  is `['requested', 'authorized', 'started', 'completed']`. A final test proves the anti-bypass
  property structurally: a `ToolRegistry.list()` descriptor has no `handler`/`policy` property at
  all — the only path to actually invoking the handler is `ToolExecutor.execute`.

**Dependency note:** `@jini/deploy`'s **runtime** dependencies are unchanged (`@jini/core`,
`@jini/platform`, `undici`) — `createDeployPublishToolRegistration` only needs `@jini/core`'s
public `ToolPolicy`/`ToolRegistration`/`ToolAuthorizationContext` types, already available from
the existing `@jini/core` dependency. `@jini/daemon` was added as a **devDependency only**
(`package.json`), used solely by `src/__tests__/tool.test.ts` to run the registration through a
real `ToolExecutor` rather than a hand-rolled stand-in — proving the gate against the actual
boundary implementation, not a test double of it. No cycle: `@jini/daemon` does not depend on
`@jini/deploy` in any form.

**What's still NOT done (follow-ups, not silently unwired):**

- **`@jini/node-host`'s `createLocalNodeDaemon` does not auto-bind any `ToolExecutor`/
  `ToolRegistry` for *any* tool yet — this is not specific to `deploy.publish`.**
  `packages/node-host/src/create-local-node-daemon.ts` (the comment directly above its
  `createAgentExecutor(...)` call, ~line 212) explicitly notes `ToolExecutorToken` is "NOT
  auto-bound here" because it "needs a caller-supplied `ToolRegistry`" — i.e. no host preset in
  this repo currently wires *any*
  registered tool (this one included) into a running daemon automatically. A caller building a
  real host today must manually: construct a `ToolRegistry` via `@jini/core`'s
  `createToolRegistry()`, call `registry.register(createDeployPublishToolRegistration({ targets,
  policy }))` (and register whatever other tools it wants), construct a `ToolExecutor` via
  `@jini/daemon`'s `createToolExecutor({ registry, delegate? })`, and hold onto that executor
  itself to call `.execute(...)` from wherever it dispatches tool calls (an HTTP route, an
  ACP-delegate bridge, etc.). This gap pre-dates this task and isn't closed by it.
  `@jini/deploy` still has zero named consumers today (`UNLOCKED.md`'s `@jini/deploy` entry:
  `"consumers": []`) — that entry is unchanged by this addition since no other package was made to
  depend on `@jini/deploy` here.
- **`ToolExecutor`-level cancellation does not propagate into an in-flight publish.** The handler
  in `tool.ts` receives `ToolExecutionContext.signal` (the abort signal `ToolExecutor` drives for
  `timeoutMs`/`cancel(executionId)`) but has nothing to forward it to: `DeployTarget.publish`/
  `checkReachability` (`types.ts`) take no `AbortSignal` parameter, and neither `vercel.ts` nor
  `cloudflare-pages.ts`'s `fetch(...)` calls accept one from outside (only `reachability.ts`'s own
  *internal* timeout controller passes a `signal:` to its `fetch`). A `ToolExecutor` timeout or
  external `cancel()` still correctly marks the *call* `'timed-out'`/`'cancelled'` in the audit
  trail and returns control to the caller, but the underlying HTTP request(s) already in flight
  inside a target's `publish` keep running to completion (or their own unrelated internal
  timeout) in the background. Threading a real `AbortSignal` through `DeployTarget.publish` down
  to every `fetch` call in both targets is a real, non-trivial change to this package's existing,
  already-tested HTTP flow — flagged here rather than attempted as a drive-by inside this task.
- **No input schema validation.** `ToolDescriptor` (`@jini/core`) has no schema field today, and
  this task didn't add one — `tool.ts`'s handler does a bare `as DeployPublishToolInput` cast on
  `ToolExecutionContext.input` (typed `unknown` by design) with no runtime shape check.
  Malformed/missing fields surface only as whatever `publishDeploy`/the matched `DeployTarget`
  itself throws (e.g. a `DeployError` for an unknown `targetId`, or a `TypeError` further down a
  target's own file-iteration if `files` isn't actually an array) — same posture `publishDeploy`
  already had before this task, not a regression, but also not hardened further here.

## 2026-07-21 addition — `NetlifyDeployTarget` (`src/netlify.ts`), the second-of-two roadmap deploy targets

**Verified the "still deferred" note above against current code before doing anything else, per
this task's instruction not to trust a possibly-stale deferred-note without checking**: re-read
`src/tool.ts` in full. Real `ToolExecutor`/`ToolRegistry` wiring is genuinely done (the
"historical" section above's sketch became real code in the 2026-07-21 `tool.ts` addition already
documented further up this file, commit `416f9dc8a`) — nothing further to do there. The
`PROP-deploy-cancellation-contract-2026-07-21.md` proposal remains untouched and unimplemented,
exactly as it should stay pending architect sign-off — no code in this addition changes
`DeployTarget.publish`/`checkReachability`'s signature, and `netlify.ts` has the same
un-cancellable-in-flight-fetch posture the "What's still NOT done" list above already documents for
Vercel/Cloudflare (not a new gap this addition introduces — see below).

**What was open and cleanly scopeable:** of the two roadmap-named-but-never-origin-implemented
targets (GitHub Pages, Netlify — see "Explicitly deferred" above), Netlify was picked because its
deploy protocol is the closer analog to `VercelDeployTarget`'s already-ported shape (create a
deployment from a content-addressed file manifest, poll a `state`/`readyState` field to a terminal
value, then wait for the resulting URL to become reachable) — GitHub Pages has no equivalent
digest-deploy API and would need a materially different design (Pages "deployments" are created
from a pre-uploaded tar.gz artifact via a separate Actions-artifact-adjacent upload flow), left
deferred, unchanged from the note above.

**Built against Netlify's own published OpenAPI 2.0 contract** (`https://open-api.netlify.com`,
fetched and parsed directly — not an LLM summary of the docs, which two independent doc-page
fetches during this task actually disagreed with each other on the deploy `state` enum, exactly the
kind of hallucination risk worth cross-checking a primary source for on real external-API code).
The ground truth used: `POST /sites/{site_id}/deploys` (async SHA1 file-digest manifest → `{id,
required[], state}`), `PUT /deploys/{deploy_id}/files/{path}` (per-required-hash upload), `GET
/deploys/{deploy_id}` (status poll), `GET /sites?name=&filter=all` / `POST /sites` (find-or-create
the target site), and — the one field this API's own inline JSON-schema types as a bare `string`
with no enum, so it was cross-checked against the *canonical* source for that exact field: the
`state` **query-filter enum** on `GET /sites/{site_id}/deploys` (the same field, used as a request
filter, which *is* enumerated) — `new, pending_review, accepted, rejected, enqueued, building,
uploading, uploaded, preparing, prepared, processing, processed, ready, error, retrying`. `'ready'`
is the only success terminal state; `'error'`/`'rejected'` are the only failure terminal states
(`NETLIFY_FAILURE_STATES`); everything else keeps polling.

| Jini file | Origin | Transform |
|---|---|---|
| `src/netlify.ts` | *(new — no OD origin; `deploy.ts` never implemented a Netlify target)* | `NetlifyDeployTarget implements DeployTarget`, same shape as `VercelDeployTarget`/`CloudflarePagesDeployTarget`. |

**Design decisions:**

- **Site find-or-create, keyed off a deterministic derived name** — `deriveNetlifySiteName(projectName)`
  is `jini-<safeDnsLabel(projectName)>`, the same deterministic (no random suffix) pattern
  `cloudflare-pages.ts`'s `deriveCloudflarePagesProjectName` already established, so repeated
  publishes of the same logical project land on the same Netlify site. Unlike Cloudflare Pages
  (whose project-lookup-by-name endpoint is a direct `GET .../pages/projects/{name}`), Netlify has
  no "get site by bare name" endpoint — `GET /sites/{site_id}` requires the real `site_id` (a UUID
  or a full `*.netlify.app`/custom domain), so lookup goes through the documented `GET
  /sites?name=&filter=all` list-and-filter endpoint instead, matching on the returned `name` field
  case-insensitively.
- **Site-name-conflict recovery is narrower than Cloudflare's, and says why in a comment.** Netlify
  site names are **globally unique across all of Netlify**, not scoped to one account (unlike a
  Cloudflare Pages project name, which only has to be unique within the account). A creation
  conflict is therefore ambiguous — it could mean *this* account already owns the name (a benign
  create/create race, recoverable by re-listing) or a different account owns it outright (not
  recoverable). `ensureNetlifySite` re-lists after a failed create and uses the result only if
  found in the caller's *own* account's sites; otherwise it rethrows the original creation error
  rather than assuming recovery the way `cloudflarePagesAlreadyExists`'s retry does.
  Tested (`recovers from a site-creation conflict by re-listing...` / `throws the original creation
  error when the site truly cannot be found...` in `netlify.test.ts`).
- **SHA1 for the file manifest, Node's built-in `crypto`, not a new dependency.** Netlify's digest
  protocol requires SHA1 specifically (unlike Cloudflare Pages' direct-upload protocol, which only
  needs *a* stable, collision-resistant key and was already swapped from `blake3-wasm` to SHA256 for
  that reason in the original Cloudflare port) — SHA1 here is a fixed wire-protocol requirement, not
  a free implementation choice, so no analogous swap applies; still zero new package dependency
  (`node:crypto`, already used by `cloudflare-pages.ts`).
- **Duplicate-content files upload once.** Netlify's own manifest protocol already declares every
  path→hash mapping in the create-deploy call; `required[]` lists hashes, not paths, and per
  Netlify's own docs "if you have two files with the same SHA1, you don't have to upload both of
  them." `createNetlifyDeploy` builds a `hash → first-matching-file` map and `publish()` uploads
  each required hash exactly once, regardless of how many manifest paths share it (tested:
  "...treats duplicate-content files as one upload").
- **No protected-response detection in `checkReachability`,** unlike Vercel's
  `isVercelProtectedResponse`. No documented Netlify equivalent to Vercel's Deployment
  Protection/SSO auth-wall convention was found; inventing a heuristic detector without a
  documented signal to key it off risks false-positives more than it helps, so `checkReachability`
  is a bare `checkDeploymentUrl(url)` call — the same choice `cloudflare-pages.ts`'s own
  `checkReachability` already made for the same reason.
- **Poll attempt/backoff constants (30 attempts, 1s×5 then 2s) copied verbatim from
  `pollVercelDeployment`,** for consistency across this package's targets rather than inventing a
  third timing convention — not a Netlify-specific requirement.
- **Cancellation is out of scope, matching the existing posture, not a new gap.** Same as
  Vercel/Cloudflare (see "What's still NOT done" above): `publish`/`checkReachability` take no
  `AbortSignal`; a `ToolExecutor` timeout still correctly marks the *call* timed-out but cannot stop
  an in-flight Netlify `fetch`. Explicitly not addressed here — that is exactly the scope
  `PROP-deploy-cancellation-contract-2026-07-21.md` already covers and is gated on architect
  sign-off; this addition does not re-litigate it or unilaterally add a signal parameter to only one
  target (which would fragment the `DeployTarget` contract further, not fix it).

**Tests:** `src/__tests__/netlify.test.ts`, 17 tests: token-missing short-circuit with no network
call; the full happy path (find existing site → create deploy → upload only the required hash →
poll to `ready` → reachable URL, asserting the manifest/required-upload/URL-candidate shapes
precisely); site auto-creation when none exists; the site-name-conflict recovery and
cannot-recover cases above; terminal `'error'` state surfacing `error_message`, and terminal
`'rejected'` state with no `error_message` falling back to a generic message; site-lookup-failure
error-message passthrough and the generic-fallback-message case; non-JSON response handling;
missing-site-id and missing-deploy-id guards; a failed required-file upload surfacing the
provider's error; skipping a `required` hash that isn't in the sent manifest (defensive, should
never happen but doesn't crash); the duplicate-content-one-upload case with nested/space-containing
path URL-encoding; poll-budget exhaustion via fake timers (mirroring `vercel.test.ts`'s own
exhaustion test, same 30-attempt/~55s-of-fake-time shape); and `checkReachability`. Package-wide
`pnpm --dir packages/deploy exec vitest run --coverage`: 134/134 tests pass; `netlify.ts` itself is
98.83% statements/98.83% lines/83.33% branches/100% functions (the 2 uncovered branch outcomes are
the `!siteName` guard in `publish()`, defensively unreachable in practice — `deriveNetlifySiteName`
always falls back to a non-empty `'site'` label before sanitizing, so it can never actually return
empty — same accepted shape as this package's other targets' analogous defensive-unreachable
guards, e.g. `cloudflare-pages.ts`'s own `!projectName` check, already named in this package's
`vitest.config.ts` threshold-comment as a known, accepted class of gap). Package-wide aggregate
99.57/80.85/100/99.57, comfortably above the package's configured 98/78/98/98 ratchet-baseline
threshold gate (`packages/deploy/vitest.config.ts`) — a slight *improvement* over the pre-existing
99.7/79.9/100/99.7 baseline noted in that file's own comment on branches (80.85 > 79.9), with a
trivial (<0.2pt) statements/lines dip from `netlify.ts` itself not being at 100%, still well within
the gate. `pnpm --dir packages/deploy exec tsc --noEmit` clean.

**Barrel:** `src/index.ts` gained `export * from './netlify.js';` — no other file changed
(`tokens.ts`'s `publishDeploy`/`DeployTargetToken` and `tool.ts`'s `ToolRegistration` already
dispatch generically over whatever `DeployTarget[]` a host binds, so `NetlifyDeployTarget` slots in
with zero changes to either).

## 2026-07-21 addition — `GitHubPagesDeployTarget` (`src/github-pages.ts`), the last of the three roadmap-named deploy targets

Closes the last item in "Explicitly deferred" above. GitHub Pages is structurally different from
Vercel/Netlify/Cloudflare Pages: none of the other three targets' "digest-deploy" shape (upload a
content-addressed file manifest, the provider says what's missing, upload just that, finalize) has
a GitHub Pages equivalent — GitHub Pages content is published either by pushing a tree of files to
a branch (the classic, provider-agnostic mechanism every non-Actions Pages deploy tool has always
used) or, newer, via an artifact-based "deployments" API. The task's own brief flagged the
artifact/tar.gz API as the *likely* better fit (closer in spirit to "upload a bundle, get a
deployment back," matching this package's other three targets) but explicitly required verifying
that against GitHub's real contract rather than assuming — doing so reversed that default.

**Research trail (both mechanisms fetched from `docs.github.com`'s live REST reference during this
task, not recalled from memory — two of this package's own prior entries, Netlify's `state` enum
and this one, independently hit real doc/memory disagreements worth cross-checking a primary source
for):**

- `POST /repos/{owner}/{repo}/pages/deployments` (the artifact-based API `actions/deploy-pages`
  uses): its request body requires an `oidc_token` field, documented as "The OIDC token issued by
  GitHub Actions certifying the origin of the deployment." This is not a value this package —
  running outside a GitHub Actions runner, authenticating with a plain PAT — has any way to obtain;
  OIDC-token minting for this endpoint is an Actions-runner-only mechanism (the identity federation
  `actions/deploy-pages` itself relies on via `core.getIDToken()`). **Rejected as infeasible for a
  headless, non-Actions caller**, not merely "less convenient."
- The Git Data API (`POST .../git/blobs`, `POST .../git/trees`, `POST .../git/commits`,
  `POST .../git/refs`, `PATCH .../git/refs/{ref}`) plus the Pages config endpoints
  (`GET`/`POST .../pages`, `GET .../pages/builds/latest`) has no such requirement — any token with
  repo write access can push a commit and enable/observe Pages against it. **Chosen.**
- A subtlety independently verified rather than assumed from general REST-API pattern-matching:
  "Get a reference" (`GET .../git/ref/{ref}`, singular `ref`) 404s on a non-existent ref; the
  "returns an array for a prefix-ambiguous match" behavior some GitHub API knowledge attributes to
  this endpoint is actually documented only for the *different* "List matching references" endpoint
  — confirmed via a direct doc fetch before writing the corresponding code, so `getGitHubRefSha`
  does not carry a defensive array-handling branch that would have been dead code against the real
  endpoint it actually calls.
- The create/update-ref path split (`GET .../git/ref/{ref}` singular vs. `POST .../git/refs` /
  `PATCH .../git/refs/{ref}` plural) is a real, easy-to-get-wrong-from-memory GitHub API quirk,
  confirmed field-for-field via direct doc fetches before implementation, not guessed.

**Design decisions:**

- **Sequencing: push the branch first, enable Pages second — not the other way round.**
  `POST /repos/{owner}/{repo}/pages` requires `source.branch` to already exist in the repository;
  enabling Pages against a not-yet-existing branch fails. `publish()` therefore always runs the full
  Git Data API flow (blob → tree → commit → create-or-update ref) before calling
  `ensureGitHubPagesSite`, so by the time Pages is (maybe) being enabled for the first time, the
  target branch is guaranteed to exist.
- **No project/site-name derivation from `input.projectName`, unlike every other target in this
  package.** A GitHub Pages "site" is intrinsically the caller's `{owner, repo}` — there is no
  "create a new site by name" concept the way Vercel/Netlify/Cloudflare Pages each have. Site
  identity is caller-supplied config (`GitHubPagesDeployConfig.owner`/`.repo`), not derived; `naming.ts`
  is unused by this file for that reason (not an oversight — `input.projectName` is used only as a
  human label in the generated commit message, with a `'site'` fallback when blank/whitespace).
- **Full-tree replace, no `base_tree`.** `DeployPublishInput.files` is, per every other target's own
  contract, "the file set to publish" — not "files to overlay onto whatever's already on the
  branch." Omitting `base_tree` on tree creation builds a tree from only the given entries, matching
  that full-replace semantic and avoiding an extra lookup call to resolve the prior tree's sha.
- **Blobs, not the tree endpoint's inline `content` shortcut.** GitHub's create-tree API accepts
  either a pre-created blob `sha` or an inline `content` string per entry — but inline `content` is
  written as-is (effectively UTF-8 text), which is not safe for a static site's binary assets
  (images, fonts). Every file gets an explicit blob (base64-encoded), deduped by a local sha256 key
  (a plain in-memory dedup key, not a wire-protocol requirement — unlike Netlify's SHA1 manifest —
  so any stable digest works; sha256 via `node:crypto` matches `cloudflare-pages.ts`'s own
  no-new-dependency choice for the same class of problem).
- **`force: true` on the branch-ref update**, even though the pushed commit is always a genuine
  fast-forward child of the looked-up tip (documented in `updateGitHubRef`'s own comment): trades a
  narrow lookup-then-update race for the same "last publish wins" semantics this package's other
  targets already have implicitly (a second concurrent `publish()` also just overwrites the first).
- **Never mutates an already-enabled Pages site's config.** If `GET .../pages` finds an existing
  site, `ensureGitHubPagesSite` leaves it exactly as configured — it does not force the site's
  `source.branch` to match `config.branch` even if they differ. Surfaced instead as
  `providerMetadata.sourceBranchMismatch: true` (only present when true) so a caller can see and act
  on a real misconfiguration rather than this package silently overriding infrastructure state the
  caller may have set up deliberately.
- **Polls `GET .../pages/builds/latest`, not the simpler, cleaner-documented `GET .../pages`
  site-level `status` field**, despite the latter's enum (`built | building | errored | null`) being
  the one this file fully cross-validated via docs. Reason: the site-level `status` is shared/reused
  across every publish to the same site, so immediately after a push it can still reflect the
  *previous* publish's terminal state for a moment — a false-positive "already built" race with no
  way to disambiguate. `builds/latest`'s `commit` field lets `pollGitHubPagesBuild` confirm it is
  actually observing *this* publish's build (`commit === commitSha`) before trusting `status` at
  all, closing that race. Trade-off, stated directly in the code comment: `builds/latest`'s own
  `status` enum did not render cleanly from a direct docs-page fetch during this task's research
  pass, so only the two terminal values (`'built'`/`'errored'`) are committed to — cross-validated
  against the sibling `GET .../pages` endpoint's confirmed clean enum, which documents the same
  underlying concept ("the status of the most recent build") — rather than trusting the full,
  imperfectly-confirmed enum. A 404 (no build registered yet — undocumented for this exact scenario,
  but consistent with GitHub REST's general not-yet-existing-resource convention) and a
  non-matching `commit` are both treated as "keep polling," not a failure. Same fixed 30-attempt/
  1s-then-2s poll budget as `pollVercelDeployment`/`pollNetlifyDeploy`, for consistency.
- **No custom-domain/CNAME automation**, unlike Cloudflare Pages' full DNS/custom-domain flow
  (`cloudflare-pages.ts`, ~300 lines). GitHub Pages custom domains have a real analog (a `cname`
  field on `PUT .../pages`, or a `CNAME` file committed alongside site content) but wiring that up
  is a materially larger scope (DNS verification, HTTPS certificate provisioning wait) the task
  brief did not ask for and this addition does not invent — flagged here as an explicit, considered
  deferral rather than a silent gap, same posture `netlify.ts`'s own "no protected-response
  detection" deferral already established for this package.
- **Cancellation is out of scope, matching the existing posture, not a new gap.** Same as
  Vercel/Netlify/Cloudflare: `publish`/`checkReachability` take no `AbortSignal`; a `ToolExecutor`
  timeout still correctly marks the *call* timed-out but cannot stop an in-flight GitHub API request.
  Covered by the same `PROP-deploy-cancellation-contract-2026-07-21.md` proposal already gating this
  across the whole package, not re-litigated here.

**Tests:** `src/__tests__/github-pages.test.ts`, 30 tests: token/owner/repo-missing short-circuits
with no network call; the full brand-new-site happy path (no existing branch, no existing Pages
config — asserting the exact tree-entry/commit/ref-create/pages-create request bodies, and that two
files sharing identical content dedupe into exactly one blob call); publishing to an already-existing
branch (asserting a fast-forward `PATCH` with `parents: [oldTipSha]`, never a `POST` create-ref, and
never a redundant Pages site re-creation); the `sourceBranchMismatch` surfacing case; a
caller-supplied non-default branch; terminal `'errored'` build state surfacing `error.message`, and
the generic-fallback-message case when it's absent; the build-poll's 30-attempt budget exhaustion via
fake timers (mirroring `vercel.test.ts`/`netlify.test.ts`'s own exhaustion tests) proceeding into the
reachability wait rather than throwing; every blob/tree/commit/ref/pages-site/build-poll HTTP-failure
and missing-required-field guard (mirroring `netlify.test.ts`'s per-endpoint coverage depth); non-JSON
and zero-status (`Response.error()`) response handling; the `html_url`-absent/`url`-present URL
fallback and the no-URL-at-all `link-delayed` case; the malformed-ref-response
(`200 OK` with no `object.sha`) defensive branch; a builds/latest entry with a missing `commit` or
`status` field being defensively skipped rather than crashing; blank/whitespace `projectName` falling
back to `'site'` in the commit message; and `checkReachability`. `github-pages.ts` itself:
100%/99.13%/100%/100% (statements/branches/functions/lines) — the one uncovered branch is the same
accepted-and-documented `fallback || generic-message` construct `netlify.ts`'s own `netlifyError`
already carries (unreachable via every one of this file's 8 real call sites, all of which pass a
non-empty fallback literal; kept as the sane default for a hypothetical future caller that omits it,
not deleted for coverage's sake). Package-wide `pnpm --dir packages/deploy test:coverage`:
172/172 tests pass, aggregate 99.78/85.41/100/99.78 — above the package's configured 98/78/98/98
ratchet-baseline gate (`packages/deploy/vitest.config.ts`) and a further improvement on branches over
the pre-existing baseline this addition found in place. `pnpm --dir packages/deploy typecheck` clean;
`pnpm guard` from repo root clean.

**Barrel:** `src/index.ts` gained `export * from './github-pages.js';`. `src/tool.ts`'s
`deploy.publish` descriptor description was updated to name Netlify and GitHub Pages alongside
Vercel/Cloudflare Pages (cosmetic only — the handler/policy logic already dispatched generically
over whatever `DeployTarget[]` a host binds, so no behavioral change was needed for
`GitHubPagesDeployTarget` to become reachable through the existing `deploy.publish` tool).

## 2026-07-22 addition — genuine ~100%-of-reachable branch coverage across the whole package (audit fix, coverage pass)

An earlier audit flagged this package at 85.41% branch coverage, calling cloudflare-pages.ts "the
most concerning" gap, and asked to re-derive from scratch whether each claimed-defensive branch is
really unreachable rather than trust any existing comment. This addition did that: read every
uncovered branch in every file (obtained authoritatively from `coverage/coverage-final.json`'s
`branchMap`/`b`, not the truncated text-table), closed the overwhelming majority with real tests
exercising real API-response shapes, applied two real refactors that eliminated genuinely dead code
in `reachability.ts`, and — only where independently re-proven, never accepted on a prior comment's
word — documented the rest as unreachable with both an inline code comment at the exact branch and
an entry here.

**`reachability.ts`** (87.95% → 98.61% branch; **2 real refactors that eliminate dead branches
entirely**, not just test them):
- **Refactor 1 — `checkDeploymentUrl`'s two `? get : head` / `? get : get.statusMessage ? get :
  head` ternaries were provably always `get`.** Traced every return shape `requestDeploymentUrl`
  can produce: the two `reachable: false` shapes reachable at those exact lines (the generic
  non-2xx/3xx fallback, and the outer-catch fallback) always set a non-empty template-string
  `statusMessage`; the `status: 'protected'` shape is already excluded by an earlier `if
  (...status === 'protected') return ...` check on the same variable. So `get.statusMessage` is
  unconditionally truthy wherever those ternaries ran, and (for the `get.reachable ? get : ...`
  outer case) the `reachable: true` shape is handled identically by both branches anyway.
  Simplified both to `return get;`, with a comment recording the case-by-case proof so a future
  editor doesn't have to re-derive it. Same reasoning eliminated `waitForReachableDeploymentUrl`'s
  `result.statusMessage || lastMessage` (always truthy `result.statusMessage` by the point
  reached, since the `reachable`/`'protected'` cases already `return`ed) — replaced with a
  documented non-null assertion (`result.statusMessage!`), not `||`/`??`, so the dead branch
  can't silently come back.
- **Refactor 2 — `requestDeploymentUrl`'s `try/catch/finally` was leaving one branch structurally
  uncoverable by any test, independent of the code's own logic.** Built a throwaway local repro
  (a standalone `async function f` with the same `try { ...returns... } catch(err){ return }
  finally { cleanup }` shape, iterated three times to isolate the cause — see the git history of
  this session's scratch files, not committed) and empirically confirmed: V8's own coverage
  instrumentation for a `try/catch/finally` whose `catch` always returns (never rethrows) emits a
  synthetic branch, at the `finally` keyword's own source position, that stays at count 0 no
  matter how thoroughly the `catch` itself is exercised (tested with a catch hit via both an
  `Error` and a non-Error throw — still 0). This is a compiler/instrumentation artifact tied to
  the `try/finally` construct itself, not a real code path. Confirmed the fix independently in the
  same repro: replacing `try/finally` with an explicit `clearTimeout(timer)` call on every real
  exit path (right after the `fetch` that could need aborting, plus one in `catch`) — same runtime
  behavior, timer cleared on every exit either way — made the artifact disappear entirely (100%
  branches with the same test count). Applied the identical restructuring to the real
  `requestDeploymentUrl`, with a comment recording the repro methodology.
- **Documented unreachable, re-derived, not trusted from any prior comment:** `assertSafeDeploymentUrl`'s
  catch's `err instanceof Error ? ... : String(err)` — the `String(err)` side is unreachable
  because `assertSafeDeploymentUrl`'s only two throw sources (`assertSafePublicUrl`, read directly
  from `packages/platform/src/asset-cache.ts`, and this function's own explicit throw) both only
  ever throw `AssetCacheError`, which `extends Error`. `reachability.ts:118` (inline comment there
  has the full trace).
- **Real tests added:** a non-Error rejection (`mockRejectedValue('boom')`) proving the *other*
  catch's own `String(err)` side genuinely is reachable (fetch/a dispatcher can reject with any
  thrown value in real JS — this one isn't provably dead, unlike the sibling above); a
  `null`/`undefined` `urls` argument to the exported `waitForReachableDeploymentUrl` (defensive
  against a non-TypeScript or `as any` caller — the function is public API); an explicit empty
  `protectedMessage: ''` (caller-supplied, not internally-computed, so genuinely testable via the
  public surface even though no *current* target in this package passes one); and a negative
  `timeoutMs` forcing zero poll sweeps to exercise the final `lastMessage || generic` fallback for
  real (the one remaining `||` in this file that isn't dead, since it's about the loop never
  running at all, not about `statusMessage` being falsy).

**`vercel.ts`** (81.7% → 97.82% branch; 2 documented-unreachable, the rest real tests):
- **Documented unreachable:** `ready ?? undefined` in the `readyState === 'ERROR'` throw
  (`vercel.ts:119`) — `ready` is already known-truthy by the time this runs (the `readyState ===
  'ERROR'` check on the same optionally-chained `ready?.readyState` couldn't have matched
  otherwise); kept for TypeScript's sake only (`ready`'s static type is `JsonObject | null`,
  `DeployError`'s `details` param doesn't accept `null`) since the optional-chain check doesn't let
  TS narrow that away. `deploymentUrlCandidates`'s `if (!json) continue` (`vercel.ts:237`) —
  unreachable via its one real call site (`deploymentUrlCandidates(ready, created)`), both of which
  are provably non-null (`created` from `readVercelJson`, which either returns an object or throws;
  `ready` from `pollVercelDeployment`, whose loop always assigns `last` before any return) — same
  shape `netlify.ts`'s own `netlifyUrlCandidates` already documents.
- **Real tests:** `uid`-only create response (the `typeof created.uid === 'string'` fallback side
  of the id/uid nested ternary); a terminal `ERROR` state with no `error` object at all (generic
  "Vercel deployment failed." message); the poll endpoint itself (not just the create call)
  returning non-ok; a zero-status `Response.error()` that's also non-JSON (`resp.status || 502`);
  a deployment URL that already carries an explicit `https://` prefix (the regex-test true side);
  a plain-string entry inside the `aliases` array (as opposed to only `{domain}`/`{url}`-shaped
  entries); `deploymentUrl()`'s own `alias[0]` fallback when the response has no top-level `url`
  field at all; and the full empty-candidates-and-empty-initialUrl fallthrough (`candidates.length
  === 0` → `[initialUrl]`, `link.url || deploymentUrl(ready) || initialUrl` bottoming all the way
  out, and `reachableAt` staying absent) in one combined scenario.

**`netlify.ts`** and **`github-pages.ts`**: both already had their 2 (netlify.ts:164,306) and 1
(github-pages.ts:185) remaining gaps documented as unreachable from the prior session's own work
(`fallback || generic` in each file's own error formatter, and `netlifyUrlCandidates`'s `if
(!json) continue`). Independently re-derived this session, per the standing "re-derive, don't
trust" rule: read every call site of `netlifyError`/`githubError` (5 and 8 respectively) and
confirmed each passes a non-empty string literal, so the generic-message fallback truly can't be
selected; re-confirmed `netlifyUrlCandidates`'s single real call site
(`netlifyUrlCandidates(finalState, site)`) always supplies two non-null `JsonObject`s the same way
`vercel.ts`'s `deploymentUrlCandidates` does. No code changes needed in either file — the existing
comments already matched what re-derivation found.

**`cloudflare-pages.ts`** (77.09% → 93.43% branch — by far the largest gap, ~75 distinct uncovered
branch outcomes spanning nearly the whole 857-line file; this is where nearly all of this addition's
effort went). Worked top to bottom. Broad picture: **most of the ~75 gaps were real, reachable,
untested branches** (optional-field parsing across a dozen-plus Cloudflare API response shapes —
projects, upload tokens, asset check-missing/upload/upsert, zones, DNS records, custom domains,
deployments — each with a "response has the field" and "response omits the field" side that only
one side had a test for) and got closed with **~50 new real tests** added to
`src/__tests__/cloudflare-pages.test.ts`, following the file's own established
mocked-`fetch`-by-URL-pattern convention (extending `baseHandlers`/`baseHandlers2`/`baseHandlers3`/
`coreHandlers` rather than inventing a new mocking style). A **smaller but real cluster (26
branches) is genuinely unreachable**, and all 26 trace back to a small number of shared root
causes, each proven by reading the actual call graph (not assumed):

- **Root cause A — `config.projectName` is provably always non-empty.** `deriveCloudflarePagesProjectName`
  always returns a non-empty string (`safeDnsLabel(projectName) || 'site'`, then re-sanitized with
  a `'jini-'` prefix that itself always survives `safeDnsLabel`). This single fact makes
  unreachable: `cloudflarePagesProductionUrl`'s `config?.projectName ? ... : ''` (line 329);
  `cloudflarePagesProjectUrl`'s and `cloudflareAccountPagesProjectsUrl`'s own redundant
  `!config.projectName`/`!config.accountId` guards (lines 293, 307 — both already validated by
  `publish()` before `config` is ever built, for every real call path into these URL builders);
  `publish()`'s own `if (!projectName) throw ...` right after deriving it (line 956); and, one
  level further downstream, `setupCloudflarePagesCustomDomain`'s `productionUrl ? [productionUrl] :
  [deployment?.url]` / `productionUrl || link.url` (lines 993, 996) — `productionUrl` being always
  truthy means `link.url`/`deployment?.url` are never the value actually used.
- **Root cause B — a non-empty `productionUrl` cascades into `pagesDevUrl`/`hostnameFromUrl`/
  `normalizeDeploymentUrlToHostname` always seeing a well-formed, already-prefixed URL.** Since
  `pagesDevUrl = productionUrl || link.url` is always `productionUrl` (root cause A),
  `hostnameFromUrl(pagesDevUrl)` (line 770) is always called with a real `https://<dns-safe>.pages.dev`
  string — meaning `normalizeDeploymentUrlToHostname`'s own internal fallbacks (`raw || ''`, the
  `!trimmed` early return, the protocol-prefix ternary's `false` side, and the entire `catch` block
  — lines 161-168, a 4-branch cluster on one function) are all unreachable too: a non-empty,
  already-`https://`-prefixed string never fails `new URL(...)`, is never falsy, and never needs
  re-prefixing. One level further, `cloudflarePagesDnsMarker`'s `pagesTarget || projectName` (line
  864) and `shortHash`'s own `value || ''` (line 79) are unreachable for the same chained reason —
  `pagesTarget` (built from `hostnameFromUrl`'s always-succeeding result) is always truthy by the
  time either of those run.
- **Root cause C — every `DeployError` this file's own call graph can throw is a genuine `Error`
  instance.** `setupCloudflarePagesCustomDomain`'s two `err instanceof Error ? err.message :
  'fallback'` constructs (lines 793, 810) are unreachable: every throw reachable from
  `ensureCloudflarePagesCnameRecord`/`ensureCloudflarePagesDomain`'s own call graphs is either a
  `new DeployError(...)`/`cloudflareError(...)` construction or a rethrow of one — this file never
  throws a bare string/object anywhere.
- **Root cause D — `aggregateCloudflarePagesStatus`'s one real caller always supplies a defined
  `statusMessage`.** `pagesDev.statusMessage` comes from `link.statusMessage`
  (`reachability.ts`'s `ReachabilityWaitResult.statusMessage`, a *required* field, verified
  non-empty on every return path when that file's own coverage was closed this session). That
  single fact cascades through `aggregateCloudflarePagesStatus`'s own 5 remaining branches (lines
  888, 896, 900, 902, 905 — the `!customDomain` branch's `{}` alternate, the `ready`-branch and
  `else`-branch's own `pagesDev.statusMessage || fallback` constructs, and — since every one of
  `setupCloudflarePagesCustomDomain`'s return shapes always sets a truthy `statusMessage` or
  `errorCode` of its own — the `pending`-branch's `customDomain.statusMessage || fallback` and the
  `else`-branch's final `'Custom domain setup failed.'` literal) and one level further out, into
  `publish()`'s own final `aggregate.statusMessage !== undefined ? ... : {}` (line 1020 — the 26th
  and last of this file's remaining branches, same root cause, one hop further downstream).
- **Two standalone unreachable branches, proven independently (not part of clusters A-D):**
  `isCloudflareAlreadyExists`'s `body || {}` (line 254) — all 3 real call sites pass either a real
  `JsonObject` (even `{}` is truthy) or, in the one case where `err.details` could be falsy (a
  non-JSON-response `DeployError`), the fallback lands on `err.message`, always a non-empty string.
  `isCloudflareCommentError`'s `value || {}` (line 279, **not** the whole ternary — the
  `typeof value === 'string'` side is real and is exercised by the new "captures a non-JSON
  DNS-record-creation response" test) — reaching the non-string side already means `value` is a
  truthy `JsonObject` (the one way to get a non-string `value` at this call site is `err.details`
  itself being truthy). `ensureCloudflarePagesCnameRecord`'s `if (!conflictingId) throw ...`
  (line 658) — `canPatchCloudflarePagesCname`, just called to reach this branch, already requires
  `record.id` to be a truthy string as part of its own condition. `findCloudflarePagesDomain`'s `if
  (!normalizedHostname) return null` (line 716) — its one call site always passes
  `selection.hostname`, built from an already-validated non-empty `domainPrefix`/`zoneName` pair
  that can't normalize to `''`. `cloudflareError`'s own final `fallback || generic-template` (lines
  234-235) — all 14 direct call sites plus the one indirect (`fetchCloudflarePaginatedResult`,
  itself only ever called with a literal) pass a non-empty fallback string, same pattern
  `netlify.ts`/`github-pages.ts` already establish for their own error formatters.

One genuinely-caught **real bug** surfaced while writing these tests (not a coverage gap, a
behavioral one): an early draft test assumed `normalizeCloudflarePagesDeploySelection` would reject
a `customDomain` object whose fields were all non-string (numbers) with a validation error: it
doesn't — every field normalizes to `''`, tripping the "all three blank" early-exit that treats the
whole selection as *absent* rather than *invalid*. Not a bug in the production code (arguably the
more defensible behavior — malformed-to-nothing is closer to "not requested" than "requested
wrong"), but the test's wrong assumption caused a real crash (network calls attempted against an
un-mocked `fetch`) that surfaced the actual behavior; the test was rewritten to assert the real
behavior instead, and a `-bad-prefix`/non-string-in-isolation set of tests were added alongside it
to still exercise each individual field's own non-string branch.

**Verified, personally, this session**: `pnpm --dir packages/deploy exec tsc --noEmit`: clean.
`pnpm --dir packages/deploy run test:coverage` — **231/231 tests pass** (59 new: ~7 in
reachability.test.ts, ~7 in vercel.test.ts, ~50 in cloudflare-pages.test.ts), **package-wide
99.78/95.95/100/99.78** (statements/branches/functions/lines) — every remaining uncovered branch in
every file is individually proven unreachable via its real call graph and documented both inline
and above; there is no untested *reachable* branch left anywhere in this package.
`packages/deploy/vitest.config.ts`'s committed threshold raised from the prior 98/78/98/98
ratchet-baseline to 99.7/95.9/100/99.7, just under the real measured numbers (a regression now fails
CI instead of silently sliding under a wide safety margin). `pnpm --dir packages/deploy run build`:
clean. Root `pnpm guard`: clean.
