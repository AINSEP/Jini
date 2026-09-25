/**
 * ImageRouter video on the submit-then-poll tier.
 *
 * ## Why this vendor
 *
 * `providers/imagerouter.ts`'s video adapter is `buildRequest -> one fetch -> parseResponse` with
 * no poll loop at all: it holds a socket open for the entire generation, bounded only by the
 * blanket `FETCH_TIMEOUT_MS.GENERATE` (10 minute) backstop, and a restart loses the work with no
 * way to ask the vendor what happened. That sync adapter is left registered and untouched — this
 * is an additive second registration, not a replacement.
 *
 * ## Both response shapes, deliberately
 *
 * `parseSubmitResponse` accepts either shape:
 *
 * - `{ data: [{ b64_json | url }] }` — the artifact arrived on the submit itself. This is exactly
 *   what the existing sync adapter expects, so today's behaviour is preserved bit for bit and the
 *   operation completes inside the grace window.
 * - `{ id, status }` — an OpenAI-videos-style job handle, so the operation moves to `polling`.
 *
 * Handling both is not hedging: **which one ImageRouter actually returns for video is unverified
 * against the live vendor** (see this file's entry in the handoff). Implementing only the job-handle
 * shape would have been a guess that silently broke the working path; implementing both is correct
 * under either answer and costs one `if`.
 *
 * ## Config is data
 *
 * The endpoint config is a plain object argument, not baked into the module, so the same adapter
 * can later be instantiated from a database row to make a vendor runtime-addable with no redesign.
 * Note what is NOT in it: the API key. Endpoint routing is config; the secret is the signer's.
 */
import { bytesFromOpenAICompatibleData, parseOpenAICompatibleJson } from '../openai-compatible.js';
import { imageRouterSizeFor } from './imagerouter.js';
import { withUnsignedRequestInit } from '../polling-adapter.js';
import type { PollOutcome, PollingVendorAdapter, SubmitOutcome, UnsignedVendorRequest } from '../polling-adapter.js';
import type { RenderContext } from '../types.js';

const DEFAULT_BASE_URL = 'https://api.imagerouter.io/v1/openai';

/** Non-secret endpoint configuration. Sourceable from a config file or a DB row — never the API key. */
export interface ImageRouterVideoConfig {
  readonly baseUrl?: string;
  /** Overrides the catalog-derived `ctx.wireModel` for the wire request. */
  readonly wireModel?: string;
}

export interface ImageRouterVideoMeta {
  readonly wireModel: string;
  readonly size: string;
  readonly seconds: number | 'auto';
}

const TERMINAL_FAILED_STATUSES: ReadonlySet<string> = new Set(['failed', 'error', 'cancelled', 'canceled']);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Reads a vendor-supplied `Retry-After` (seconds) header, ignoring anything non-numeric. */
function retryAfterMsFrom(resp: Response): number | undefined {
  const raw = resp.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

/**
 * Builds the ImageRouter video polling adapter for a given endpoint configuration.
 *
 * @param config Non-secret endpoint overrides; defaults to ImageRouter's public base URL and the
 *   context's own `wireModel`.
 * @complexity O(1) per built request; one vendor round trip per parse.
 */
export function createImageRouterVideoPollingAdapter(
  config: ImageRouterVideoConfig = {},
): PollingVendorAdapter<ImageRouterVideoMeta> {
  const baseUrl = trimTrailingSlash((config.baseUrl || DEFAULT_BASE_URL).trim());

  return {
    expectedLatencyClass: 'slow',
    // ImageRouter's generation endpoint accepts no idempotency key, so a submit that may or may
    // not have landed cannot be safely re-issued — a duplicate submit is a duplicate charge.
    submitIsIdempotent: false,

    buildSubmitRequest(ctx: RenderContext): UnsignedVendorRequest<ImageRouterVideoMeta> {
      const wireModel = (config.wireModel || ctx.wireModel).trim();
      const seconds = typeof ctx.length === 'number' ? ctx.length : 'auto';
      const size = imageRouterSizeFor(ctx.aspect, 'video');

      return {
        url: `${baseUrl}/videos/generations`,
        init: withUnsignedRequestInit(ctx, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: ctx.prompt || 'A short cinematic clip.',
            model: wireModel,
            size,
            seconds,
            response_format: 'b64_json',
          }),
        }),
        meta: { wireModel, size, seconds },
      };
    },

    async parseSubmitResponse(
      resp: Response,
      ctx: RenderContext,
      request: UnsignedVendorRequest<ImageRouterVideoMeta>,
    ): Promise<SubmitOutcome> {
      const data = (await parseOpenAICompatibleJson(resp, 'imagerouter video')) as Record<string, unknown>;

      if (Array.isArray(data.data)) {
        const bytes = await bytesFromOpenAICompatibleData(data, 'imagerouter video', ctx.requestInit);
        const { wireModel, size, seconds } = request.meta;
        return {
          kind: 'complete',
          result: {
            bytes,
            providerNote: `imagerouter/${wireModel} · ${size} · ${seconds === 'auto' ? 'auto' : `${seconds}s`} · ${bytes.length} bytes`,
            suggestedExt: '.mp4',
          },
        };
      }

      if (typeof data.id === 'string' && data.id) {
        // Only the job handle is persisted — no credential, no request body.
        const retryAfterMs = retryAfterMsFrom(resp);
        return { kind: 'pending', state: { jobId: data.id }, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
      }

      throw new Error('imagerouter video submit returned neither generated data nor a job id');
    },

    buildPollRequest(state: Readonly<Record<string, unknown>>, ctx: RenderContext): UnsignedVendorRequest<ImageRouterVideoMeta> {
      const jobId = state.jobId;
      if (typeof jobId !== 'string' || !jobId) {
        throw new Error('imagerouter video poll requires a persisted jobId');
      }
      return {
        url: `${baseUrl}/videos/${encodeURIComponent(jobId)}`,
        init: withUnsignedRequestInit(ctx, { method: 'GET', headers: { accept: 'application/json' } }),
        meta: { wireModel: (config.wireModel || ctx.wireModel).trim(), size: imageRouterSizeFor(ctx.aspect, 'video'), seconds: typeof ctx.length === 'number' ? ctx.length : 'auto' },
      };
    },

    async parsePollResponse(resp: Response, ctx: RenderContext, _state: Readonly<Record<string, unknown>>): Promise<PollOutcome> {
      const data = (await parseOpenAICompatibleJson(resp, 'imagerouter video')) as Record<string, unknown>;
      const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';

      if (TERMINAL_FAILED_STATUSES.has(status)) {
        const error = data.error as { message?: unknown } | undefined;
        const detail = typeof error?.message === 'string' && error.message ? error.message : status;
        return { kind: 'failed', message: `imagerouter video job failed: ${detail}` };
      }

      if (Array.isArray(data.data)) {
        const bytes = await bytesFromOpenAICompatibleData(data, 'imagerouter video', ctx.requestInit);
        const wireModel = (config.wireModel || ctx.wireModel).trim();
        const size = imageRouterSizeFor(ctx.aspect, 'video');
        const seconds = typeof ctx.length === 'number' ? ctx.length : 'auto';
        return {
          kind: 'complete',
          result: {
            bytes,
            providerNote: `imagerouter/${wireModel} · ${size} · ${seconds === 'auto' ? 'auto' : `${seconds}s`} · ${bytes.length} bytes`,
            suggestedExt: '.mp4',
          },
        };
      }

      const retryAfterMs = retryAfterMsFrom(resp);
      return { kind: 'pending', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
    },
  };
}
