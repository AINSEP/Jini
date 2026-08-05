# Proposal: deadline/cancellation contract for `DeployTarget` (CR-R3)

**Status:** Proposal only — not implemented. Requires Software Architect review before any code change, per the code review's explicit `ARCHITECTURE_REVIEW_REQUIRED` classification and this task's own scope boundary (`@jini/deploy` itself still awaits sign-off for inclusion in the locked package architecture — see `ADS-memory/reports/jini-port/extraction-plan.md`'s package set and `packages/deploy/source-map.md`).

**Finding:** `ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md`, R3 (High).

**Do not implement from this document without a follow-up decision.** No changes were made to `packages/deploy/src/types.ts`, `packages/deploy/src/vercel.ts`, or `packages/deploy/src/cloudflare-pages.ts` as part of writing this proposal.

## The problem

`DeployTarget.publish`/`checkReachability` (`packages/deploy/src/types.ts:75-79`) expose no `AbortSignal` or deadline:

```ts
export interface DeployTarget {
  readonly id: string;
  publish(input: DeployPublishInput): Promise<DeployPublishResult>;
  checkReachability(url: string): Promise<DeploymentUrlCheck>;
}
```

Both concrete adapters make multiple sequential (and, for Cloudflare, batched) provider calls with no way for a caller to cancel or bound the total wall-clock time:

- **Vercel** (`packages/deploy/src/vercel.ts`): `publish()` makes an unbounded `fetch()` to create the deployment (line ~79), then calls `pollVercelDeployment()` (lines 145-158), a fixed 30-attempt loop where *each* `fetch()` inside it (line ~149) is itself unbounded, then hands off to `waitForReachableDeploymentUrl` (`reachability.ts`), which has its own `timeoutMs` budget but no way to be cancelled early by the caller.
- **Cloudflare Pages** (`packages/deploy/src/cloudflare-pages.ts`): `ensureCloudflarePagesProject` (lines 301-321), `getCloudflarePagesUploadToken` (323-330), `cloudflarePagesMissingAssetHashes` (332-340), the batched upload loop inside `uploadCloudflarePagesAssets` (342-397, calls at ~365 and ~388), plus DNS/domain calls elsewhere in the same file (~423-460, ~601-613, ~809) — every one of these `fetch()` calls is unbounded.

A hung upstream socket on any single one of these calls leaves the whole `publish()` call permanently pending — there is no way for a caller (an HTTP route handler, a CLI command, a tool execution with its own timeout) to give up and move on. The new provider test suites added in the coverage-push commit mock only settling responses; none exercise a hung-request/cancellation scenario, which is itself informative — the seam to test doesn't exist yet.

## Why this is an architecture decision, not a mechanical fix

`@jini/deploy` "still awaits sign-off for inclusion in the locked package architecture" (per the code review). The `DeployTarget` port is the seam every current and future provider adapter implements, and every current and future caller (an HTTP route, a tool handler, a CLI command) depends on. Getting the cancellation/deadline shape right here is exactly the kind of contract decision `ADS-memory/reports/jini-port/extraction-plan.md`'s locked design process is for — a cloud agent picking an ad hoc shape (a raw `timeoutMs` number? an `AbortSignal`? a custom cancellation token type?) risks becoming a second, incompatible cancellation convention alongside whatever the kernel (`RunLifecycle`, `ToolExecutor`) already establishes for its own cancellation propagation, which this package should probably match rather than reinvent.

## Proposed contract shape (for architect review)

### 1. Standardize on `AbortSignal`, not a custom cancellation type or a raw timeout number

```ts
export interface DeployCallOptions {
  /** Aborting this signal cancels the in-flight publish/reachability call as soon as possible. */
  readonly signal?: AbortSignal;
}

export interface DeployTarget {
  readonly id: string;
  publish(input: DeployPublishInput, options?: DeployCallOptions): Promise<DeployPublishResult>;
  checkReachability(url: string, options?: DeployCallOptions): Promise<DeploymentUrlCheck>;
}
```

Rationale: `AbortSignal` is the platform-standard cancellation primitive Node's own `fetch` already accepts directly, and `AbortSignal.timeout(ms)` gives callers a deadline for free without this package inventing its own `timeoutMs` parameter that then has to be converted to an `AbortSignal` internally anyway (both `reachability.ts` and `@jini/platform`'s `asset-cache.ts` already build `AbortController`/`signal` internally for their own per-request timeouts — this proposal is about exposing that same primitive at the `DeployTarget` boundary, not introducing a new one). A caller wanting "cancel after 60s" just does `{ signal: AbortSignal.timeout(60_000) }`; a caller wanting "cancel when the user clicks stop" passes their own `AbortController.signal`; a caller wanting both composes them (`AbortSignal.any([...])`, available in current Node LTS).

`DeployCallOptions` is a separate second parameter (matching `fetch(input, init)`'s own shape) rather than a field on `DeployPublishInput`, so the domain input (files + project name + metadata) stays a pure data shape and the cancellation plumbing doesn't leak into it.

### 2. Threading through Vercel

- `VercelDeployTarget.publish(input, options)`: pass `options?.signal` into the create-deployment `fetch()`'s `RequestInit.signal`, into `pollVercelDeployment(config, id, options?.signal)` (new third param), and into the `waitForReachableDeploymentUrl(candidates, { ...existingOptions, signal: options?.signal })` call — `reachability.ts`'s `ReachabilityWaitOptions`/`ReachabilityOptions` would need their own optional `signal` field threaded into `requestDeploymentUrl`'s `fetch()` call and checked once per sweep of the polling loop (`if (signal?.aborted) break;` before starting a new sweep, in addition to passing `signal` into the per-request `fetch()` for mid-flight cancellation).
- `pollVercelDeployment`: check `signal?.aborted` at the top of each loop iteration (fail fast without waiting for the next backoff sleep) and pass `signal` into its own `fetch()` call.
- `VercelDeployTarget.checkReachability(url, options)`: pass `options?.signal` through to `checkDeploymentUrl`.

### 3. Threading through Cloudflare Pages

Same pattern applied to every sequential call: `ensureCloudflarePagesProject`, `getCloudflarePagesUploadToken`, `cloudflarePagesMissingAssetHashes`, each `fetch()` inside `uploadCloudflarePagesAssets`'s batch loop (checking `signal?.aborted` before starting each batch, not just passing `signal` into the `fetch()` itself, since a large asset set could have many batches and a cancelled caller shouldn't have to wait for the current batch's network round-trip before the next one is skipped), the final upsert-hashes call, and the DNS/custom-domain calls. Every one of these currently-private helper functions would gain an additional `signal?: AbortSignal` parameter threaded down from `publish(input, options)`.

### 4. Resulting `DeployError` shape on timeout/cancel

```ts
// Illustrative — exact status/code values are for the architect to confirm, not fixed here.
new DeployError('Deploy cancelled before completion.', 499, { aborted: true }, 'DEPLOY_CANCELLED');
```

- A stable `code: 'DEPLOY_CANCELLED'` (or whatever naming convention the architect prefers — matching, if one exists, the kernel's own cancellation-outcome vocabulary rather than inventing a sibling one) distinguishes "the caller asked to stop" from a genuine upstream failure, so a route handler can map it to a different HTTP status than a real provider error.
- `status: 499` is the informal-but-widely-recognized "client closed request" code; 408 (Request Timeout) is the alternative if the architect prefers a registered status. Either is defensible; this proposal does not decide it.
- Every `fetch()` call site that currently does `catch` handling for provider errors (e.g. Vercel's `vercelError`/Cloudflare's `cloudflareError` helpers) needs a branch that recognizes an `AbortError`/`DOMException` from an aborted signal and maps it to this stable shape instead of falling through to the generic "provider request failed" path — today's error helpers assume every thrown error is a provider-shaped JSON error, which an abort is not.
- `AbortSignal`'s own `.reason` (e.g. a `TimeoutError` DOMException from `AbortSignal.timeout()` vs. an explicit `controller.abort(new Error('user cancelled'))`) can optionally be surfaced in `DeployError.details` for callers that want to distinguish "timed out" from "explicitly cancelled," but the proposal does not require adapters to make that distinction themselves — both collapse to the same aborted-fetch exception shape at the call site.

## What the test evidence should look like

A follow-up PR implementing this (after architect sign-off) should add, for both Vercel and Cloudflare:

1. A test that aborts the signal *before* calling `publish()`/`checkReachability()` and asserts the call rejects near-immediately with the stable cancellation `DeployError`, without making any network call (assert the injected `fetch` mock was never invoked).
2. A test that aborts the signal *while* the create/poll/upload sequence is in flight (e.g. an injected `fetch` that resolves only after the test aborts the controller) and asserts the in-flight call rejects with the same stable shape rather than hanging or surfacing a generic provider-error shape.
3. For the poll loops specifically (Vercel's `pollVercelDeployment`, Cloudflare's asset-upload batch loop): a test that aborts between iterations and asserts no further `fetch()` calls happen after that point (proving the `signal?.aborted` fail-fast check works, not just that the underlying `fetch()` eventually rejects).
4. No wall-clock `sleep`/real timers in these tests — use fake timers (already the convention for the existing poll-loop tests in `vercel.test.ts`/`cloudflare-pages.test.ts`) so the abort-during-poll scenario doesn't add real wait time to the suite.

## Open questions for the architect

1. Confirm `AbortSignal` (vs. a custom cancellation-token type) is the right primitive for this package, and whether it should also become the convention for any *other* future `@jini/deploy` provider adapter's own long-running operations (e.g. a hypothetical GitHub Pages/Netlify target named in the extraction plan's §10 roadmap appendix).
2. Confirm the exact `DeployError` `status`/`code` values for the cancelled case (499 vs 408; the exact `code` string).
3. Decide whether `checkReachability`'s signal should also propagate into `reachability.ts`'s `waitForReachableDeploymentUrl` polling loop generically (benefiting every current/future caller of that function, not just deploy targets) or whether that's a separate, `@jini/deploy`-external change requiring its own review — `reachability.ts` is invoked directly by both adapters today and doesn't have a signal parameter at all yet.
4. Decide whether this cancellation contract should be retrofitted onto `DeployTarget` as an optional second parameter (backward compatible — existing callers that don't pass `options` see no behavior change) or whether the architect wants a version bump / breaking contract change instead, given the package hasn't been added to the locked architecture yet and might prefer to land the contract "correct from the start" rather than as a later addition.
