/**
 * `PollingVendorAdapter` — the submit-then-poll tier, added alongside (never replacing)
 * `vendor-adapter.ts`'s `VendorAdapter`.
 *
 * This is purely additive. `VendorAdapter` is proven across all 18 live registrations and is
 * untouched: a vendor that finishes inside one request/response keeps using it. This interface is
 * for the other shape — a vendor that hands back a job handle and makes you come back for the
 * result — which `dispatchVendorRequest`'s fixed `buildRequest -> one fetch -> parseResponse`
 * cannot express at all.
 *
 * ## The credential seam
 *
 * The deliberate difference from `VendorAdapter`: **these builders never receive credentials.**
 * `VendorAdapter.buildRequest(ctx, credentials)` hands the adapter a `ProviderCredentials` and the
 * adapter writes its own `authorization` header. That is fine for one in-process round trip, but a
 * polled operation outlives the request that started it, so a secret reachable from the adapter is
 * a secret that wants to be persisted next to the job handle. Here the adapter builds an
 * *unsigned* request and a `RequestSigner` attaches auth beneath it, re-resolved on every tick —
 * which is also what makes a token that expires mid-poll a non-event.
 */
import type { MediaGenerationRequestInit, ProviderCredentials, RenderContext, RenderResult } from './types.js';

/**
 * Whether this vendor is expected to answer within an interactive grace window. It is a property
 * of the *vendor*, declared once per adapter — never a property of the caller, which is what keeps
 * the human UI and an agent on one identical contract.
 */
export type ExpectedLatencyClass = 'fast' | 'slow';

/** A vendor request with no auth applied. `init.headers` carries content negotiation only. */
export interface UnsignedVendorRequest<Meta = undefined> {
  readonly url: string;
  readonly init: RequestInit;
  readonly meta: Meta;
}

/** What a submit response turned out to be: the finished artifact, or a handle to come back for. */
export type SubmitOutcome =
  | { readonly kind: 'complete'; readonly result: RenderResult }
  | { readonly kind: 'pending'; readonly state: Readonly<Record<string, unknown>>; readonly retryAfterMs?: number };

export type PollOutcome =
  | { readonly kind: 'complete'; readonly result: RenderResult }
  | { readonly kind: 'pending'; readonly retryAfterMs?: number }
  | { readonly kind: 'failed'; readonly message: string; readonly code?: string };

export interface PollingVendorAdapter<Meta = undefined> {
  readonly expectedLatencyClass: ExpectedLatencyClass;
  /**
   * Whether re-issuing the submit request is safe when a crash left us unable to tell whether the
   * first one reached the vendor. Defaults to `false`, which routes that row to `unknown` for
   * reconciliation instead. There is no unqualified retry-once rule: media generation costs real
   * money per call, so a retry must be *proven* safe, not assumed.
   */
  readonly submitIsIdempotent?: boolean;
  buildSubmitRequest(ctx: RenderContext): UnsignedVendorRequest<Meta>;
  parseSubmitResponse(resp: Response, ctx: RenderContext, request: UnsignedVendorRequest<Meta>): Promise<SubmitOutcome>;
  buildPollRequest(state: Readonly<Record<string, unknown>>, ctx: RenderContext): UnsignedVendorRequest<Meta>;
  parsePollResponse(resp: Response, ctx: RenderContext, state: Readonly<Record<string, unknown>>): Promise<PollOutcome>;
}

/**
 * A `PollingVendorAdapter` with its `Meta` erased, for heterogeneous lookup by
 * `(providerId, routeKey)`. `Meta` never crosses this boundary — it only flows from one adapter's
 * own `build*` to that same adapter's `parse*` — so erasing it here is sound, unlike the `never`
 * that `VendorAdapterRegistry` uses (which is only sound because every caller re-casts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPollingVendorAdapter = PollingVendorAdapter<any>;

/** A signed request, ready to hand to `fetch`. */
export interface SignedVendorRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * The broker seam: attaches auth to an unsigned request. Async because a real broker resolves from
 * a vault / refreshes an OAuth token, and is called once per tick rather than once per operation.
 */
export type RequestSigner = (request: UnsignedVendorRequest<unknown>) => Promise<SignedVendorRequest> | SignedVendorRequest;

/**
 * Reference signer for the `Authorization: Bearer <key>` scheme every vendor in this package uses.
 *
 * `resolve` is invoked per call, never cached here — caching a resolved key inside the signer would
 * reintroduce exactly the mid-stream-expiry problem this seam exists to remove.
 *
 * @throws When `resolve` yields no `apiKey`, using `missingCredentialMessage` — the failure surfaces
 *   at signing time rather than as an opaque vendor 401.
 * @complexity O(1) plus whatever `resolve` costs.
 */
export function createBearerSigner(
  required: { resolve: () => Promise<ProviderCredentials> | ProviderCredentials; missingCredentialMessage: string },
): RequestSigner {
  return async (request) => {
    const credentials = await required.resolve();
    if (!credentials.apiKey) {
      throw new Error(required.missingCredentialMessage);
    }
    return {
      url: request.url,
      init: {
        ...request.init,
        headers: { ...(request.init.headers as Record<string, string> | undefined), authorization: `Bearer ${credentials.apiKey}` },
      },
    };
  };
}

/** Carries a caller-supplied `dispatcher` onto an unsigned request, matching `withRequestInit`'s role on the sync tier. */
export function withUnsignedRequestInit(ctx: { readonly requestInit: MediaGenerationRequestInit }, init: RequestInit): RequestInit {
  return { ...init, ...(ctx.requestInit.dispatcher ? { dispatcher: ctx.requestInit.dispatcher } : {}) };
}
