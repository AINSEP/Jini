/**
 * The generic vendor-adapter dispatch core — the mechanism every registered
 * media vendor's HTTP round trip runs through: validate credentials, build a
 * request, perform exactly one `fetch`, then hand the response to a
 * vendor-supplied parser. This is the piece `source-map.md`'s 2026-07-21
 * dispatch-engine entry flagged as missing ("the actual multi-provider REST
 * dispatch engine and durable task adapter" — each vendor was "essentially
 * its own hand-written function, not a generalized system that can register
 * a new vendor via configuration"): a vendor is now a `VendorAdapter` —
 * (auth-scheme, request-shape, response-parsing/error-mapping)
 * *configuration* passed to `dispatchVendorRequest` via
 * `VendorAdapterRegistry` (see `vendor-registry.ts`) — not a bespoke async
 * function that reimplements fetch/error-handling/byte-extraction inline
 * every time.
 *
 * `parseResponse` is intentionally still a full function, not a further
 * declarative shape — several real vendors need a *second* network call
 * inside their "response parsing" step (SenseAudio's SSRF-guarded asset
 * download, AIHubMix's Gemini-native redirect), which a purely declarative
 * parser DSL can't express without becoming its own bespoke escape hatch
 * anyway. The genericity this module buys is in the *harness* (uniform
 * credential-check -> build -> fetch -> parse flow, pluggable via the
 * registry), not in eliminating vendor-specific wire logic that doesn't
 * actually repeat across vendors. Where response-parsing genuinely IS
 * identical across vendors (MiniMax's and SenseAudio's TTS envelope), see
 * `response-parsers.ts`'s `createHexEnvelopeAudioParser` for the shared,
 * reusable piece.
 */
import type { ProviderCredentials, RenderContext, RenderResult } from './types.js';

/**
 * One vendor HTTP request, plus any values `buildRequest` computed that
 * `parseResponse` also needs (e.g. a resolved `wireModel`/`voiceId` for
 * building `providerNote`). Kept out of `RenderContext` because these are
 * per-adapter derived values, not universal fields every vendor shares.
 */
export interface VendorRequest<Meta = undefined> {
  readonly url: string;
  readonly init: RequestInit;
  readonly meta: Meta;
}

export type VendorRequestBuilder<Meta = undefined> = (ctx: RenderContext, credentials: ProviderCredentials) => VendorRequest<Meta>;

/**
 * Turns a `fetch` `Response` into a `RenderResult`, or throws a
 * vendor-tagged `Error` — the "response-parsing + error-mapping" half of a
 * vendor adapter. Receives `ctx`/`request` too since some vendors need a
 * second request (an SSRF-guarded asset download, a Gemini-native
 * redirect) to finish parsing — see this module's doc comment.
 */
export type VendorResponseParser<Meta = undefined> = (
  resp: Response,
  ctx: RenderContext,
  request: VendorRequest<Meta>,
) => Promise<RenderResult>;

/** Validates `credentials` before any network call, throwing a vendor-tagged `Error` when they're unusable (e.g. no API key configured). */
export type VendorCredentialGuard = (credentials: ProviderCredentials) => void;

/**
 * A fully-configured vendor: the "auth-scheme" (`requireCredential`),
 * "request-shape" (`buildRequest`), and "response-parsing + error-mapping"
 * (`parseResponse`) a new vendor registers instead of writing a bespoke
 * `render*` function.
 */
export interface VendorAdapter<Meta = undefined> {
  readonly requireCredential?: VendorCredentialGuard;
  readonly buildRequest: VendorRequestBuilder<Meta>;
  readonly parseResponse: VendorResponseParser<Meta>;
}

/**
 * The generic dispatch core: `requireCredential` -> `buildRequest` -> one
 * `fetch` -> `parseResponse`. Every migrated vendor's `render*` export is
 * now a one-line call to this (see `providers/minimax.ts`,
 * `providers/senseaudio.ts`, `providers/fishaudio.ts`, `providers/openai.ts`
 * for real examples). `parseResponse` runs even on a non-2xx response —
 * unlike `fetch` itself, an HTTP error status is not a rejected `Promise`,
 * so mapping a bad status into a thrown `Error` is each adapter's own job,
 * exactly like every hand-written `render*` function already did.
 */
export async function dispatchVendorRequest<Meta = undefined>(
  adapter: VendorAdapter<Meta>,
  ctx: RenderContext,
  credentials: ProviderCredentials,
): Promise<RenderResult> {
  adapter.requireCredential?.(credentials);
  const request = adapter.buildRequest(ctx, credentials);
  const resp = await fetch(request.url, request.init);
  return adapter.parseResponse(resp, ctx, request);
}

/**
 * Reference `requireCredential` guard: throws `message` when
 * `credentials.apiKey` is unset. Covers every ported vendor's own
 * "no credential" check — each currently hand-writes the identical
 * `if (!credentials.apiKey) throw new Error(...)` line with only the
 * message text differing.
 */
export function requireApiKey(message: string): VendorCredentialGuard {
  return (credentials) => {
    if (!credentials.apiKey) {
      throw new Error(message);
    }
  };
}
