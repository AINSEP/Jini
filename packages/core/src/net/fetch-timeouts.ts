/**
 * Shared vocabulary for outbound-fetch timeout classes. `FETCH_TIMEOUT_MS` gives call sites a small,
 * documented set of named ceilings instead of an invented number each time: a deploy-provider API
 * call, an image byte-fetch, and a large asset upload genuinely have different reasonable limits.
 * Callers still name the timeout explicitly (usually one of these constants), because a reader of the
 * call site should see the number rather than hunt for a hidden default.
 */

/**
 * Shared, documented timeout classes for outbound `fetch()` calls. Every call site names one
 * explicitly (or its own justified number) rather than relying on an unstated default.
 */
export const FETCH_TIMEOUT_MS = {
  /** A single metadata/status/API-read call expected to return quickly: a model catalog listing, a
   * connection test, a GitHub API read, an LLM provider's non-streaming completion call. */
  QUICK: 15_000,
  /** A deploy-provider API call that may involve real backend work on the provider's side — site
   * creation, DNS record lookups, deployment status polling. */
  DEPLOY: 30_000,
  /** A large-payload transfer: an asset/blob upload, a generated-media byte fetch. */
  UPLOAD: 120_000,
  /** A media-generation API call whose response only arrives once the vendor has actually finished
   * generating the image/video/audio server-side — routinely minutes, not seconds. Matches the
   * value OpenAI's and OpenRouter's own image providers already hardcode locally
   * (`OPENAI_IMAGE_*_TIMEOUT_MS`/`OPENROUTER_IMAGE_TIMEOUT_MS`); used as the shared dispatch-level
   * backstop in `@jini-ai/integrations`' `dispatchVendorRequest` for every OTHER vendor that (as of
   * 2026-08-16) sets no timeout of its own at all. Deliberately NOT the same as `UPLOAD`: a backstop
   * shorter than a vendor's own already-correct 10-minute generation timeout would abort a
   * legitimately still-generating request early. */
  GENERATE: 10 * 60_000,
} as const satisfies Record<string, number>;


/** Opt-in byte and decoding guards; defaults remain unlimited and replacement-decoded. */
export type TextReadOptions = {
  /** Nonnegative safe integer. Actual streamed bytes, independent of Content-Length. */
  maxResponseBytes?: number;
  /** Reject malformed UTF-8, including an incomplete trailing character. */
  strictUtf8?: boolean;
};
