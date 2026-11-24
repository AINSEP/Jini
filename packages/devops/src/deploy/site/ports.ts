import type { HttpClientPort } from "@jini-ai/core/primitives";

import type { DeploymentProviderId, DeploymentRunStatus, DeploymentTargetRecord, ReleaseRecord } from "./types.js";

/**
 * @file The provider-neutral deployment port — the seam every first-party adapter
 * (`@jini-ai/agent-plugins/github/deployments/github.mjs`, and later others) implements once.
 *
 * Purpose:
 * Mirrors `Jini packages/commerce/src/payments/ports.ts`'s `PaymentProvider` discipline, which this codebase
 * already uses for a structurally similar problem (many third-party providers behind one typed,
 * never-throwing port, all outbound HTTP through the ADR-038 guarded seam): no method throws
 * (every failure is a typed `DeploymentError`), credentials are pre-resolved and injected as a flat
 * bundle rather than read by the adapter, and `ctx.httpClient` is the only permitted path to the
 * network.
 *
 * How it relates to the project:
 * The host's `EgressPolicy` is bound once, at `HttpClientPort` construction
 * (the host's `createHttpClient({ transport, policy })`), not per request; there is no
 * per-request policy field on `HttpRequest`. It also has no field that can restrict which HOST a
 * request reaches (`devHostAllowlist` only exempts a host from the private-address check). So
 * origin pinning for a specific provider's API is the ADAPTER's responsibility, asserted through a
 * single chokepoint every outbound call is forced through — see `@jini-ai/agent-plugins/github/deployments/github.mjs`'s
 * `sendPinned`, the only function in that file allowed to call `ctx.httpClient.send`.
 *
 * Architectural role:
 * INTERFACES ONLY. `@jini-ai/agent-plugins/github/deployments/github.mjs` is the first (and, this pass, only) implementation.
 * Generic over the HTTP client type (`THttpClient`, default `@jini-ai/core/primitives`' `HttpClientPort`)
 * so a host whose guarded client keeps a different `send` call shape pins its own type at the use site;
 * these are types only, so the seam has no runtime behaviour of its own.
 */

export type DeploymentErrorCode =
  | "NO_CREDENTIALS_CONFIGURED"
  | "INVALID_TARGET_CONFIG"
  | "INVALID_RELEASE"
  | "TRANSPORT_ERROR"
  | "PROVIDER_ERROR"
  | "PROVIDER_RESPONSE_INVALID";

/** Mirrors `PaymentError`'s shape (`Jini packages/commerce/src/payments/ports.ts`) — typed, never thrown, plus
 * `retryable`. */
export interface DeploymentError {
  readonly code: DeploymentErrorCode;
  readonly message: string;
  readonly providerStatus?: number;
  /** True = retrying the same call may succeed (a transport failure, a 5xx, a rate limit). */
  readonly retryable: boolean;
}

export interface DeploymentProviderContext<THttpClient = HttpClientPort> {
  /** Already resolved by core from `DeploymentProviderPort.credentialKeys`, scoped to THIS
   * provider — same deviation `ProviderContext.credentials` documents in `Jini packages/commerce/src/payments/ports.ts`: a
   * provider cannot read a peer provider's credentials, and "not configured" is checked once,
   * uniformly, before any adapter code runs. */
  readonly credentials: Readonly<Record<string, string>>;
  /** The ADR-038 guarded seam, already constructed with this provider's `EgressPolicy`. There is no
   * other way for an adapter to make an outbound call. */
  readonly httpClient: THttpClient;
  readonly now: () => number;
}

export interface StartDeploymentRunInput {
  readonly target: DeploymentTargetRecord;
  readonly release: ReleaseRecord;
}

export type StartDeploymentRunResult =
  | {
      readonly ok: true;
      /** The provider's own identifier for the run just started. Never `null` on success. */
      readonly providerRunRef: string;
      readonly reconciliation: "poll" | "callback";
    }
  | { readonly ok: false; readonly error: DeploymentError };

export interface PollDeploymentRunInput {
  readonly target: DeploymentTargetRecord;
  readonly providerRunRef: string;
}

export interface DeploymentRunStatusUpdate {
  readonly status: DeploymentRunStatus;
  /** The provider's own identifier for the status observation itself (distinct from
   * `providerRunRef`, which identifies the run). `null` when the provider has not reported any
   * status yet — GitHub returns this immediately after `startRun`, before its first webhook or a
   * caught-up poll. */
  readonly providerStatusId: string | null;
  /** Sanitized provider-supplied text, if any. Never raw. */
  readonly message: string | null;
}

export type PollDeploymentRunResult =
  | { readonly ok: true; readonly update: DeploymentRunStatusUpdate }
  | { readonly ok: false; readonly error: DeploymentError };

/**
 * One deployment provider. Implemented once per provider, in its own file under `./providers/`,
 * and (in a later slice) registered — core never enumerates implementations of this interface, the
 * same rule `PaymentProviderRegistry` enforces for payments.
 *
 * Deliberately excluded this pass (see the handoff report's REMAINING section for why each is
 * deferred, not forgotten):
 * - No `validateTarget` — admin "configure target" UX is out of scope for this slice.
 * - No `cancelRun` — the R1-R3 debate consensus is that rollback IS `startRun` with a prior
 *   `releaseId`, not a distinct cancel operation; GitHub's Deployments API has no cancel endpoint
 *   for an already-created deployment in any case.
 * - No streaming-logs method — `EgressPolicy`'s response caps are sized for bounded JSON, not a
 *   long-lived connection; that is new design work, not a v1 default.
 */
export interface DeploymentProviderPort<THttpClient = HttpClientPort> {
  readonly id: DeploymentProviderId;
  /** Credential slot names this provider needs (e.g. `["appId", "installationId",
   * "privateKeyPem"]`). Declaring them as DATA — rather than an adapter reading env vars inline —
   * is what lets a future core layer report a misconfigured provider uniformly, before any adapter
   * code runs. */
  readonly credentialKeys: readonly string[];

  /** MUST return promptly with a reference to poll or await a callback for — never blocks until the
   * deployment finishes. */
  startRun(input: StartDeploymentRunInput, ctx: DeploymentProviderContext<THttpClient>): Promise<StartDeploymentRunResult>;

  /** Only ever called when reconciliation requires it — either as the sole mechanism for a
   * `reconciliation: "poll"` run, or as the recovery path for a `"callback"` run whose webhook
   * never arrived (or, for GitHub specifically, whose terminal state is `inactive`, which GitHub
   * never delivers as a webhook at all). */
  pollRun(input: PollDeploymentRunInput, ctx: DeploymentProviderContext<THttpClient>): Promise<PollDeploymentRunResult>;
}
