/**
 * @file The PostHog adapter for `ProductAnalyticsPort` — a vendor PROVIDER subpath
 * (`@jini-ai/analytics/product/posthog`), the only module in this package that imports
 * `posthog-node` (an optional peer dependency, pinned by the host). Owner 2026-10-25: "since
 * PostHog is free, let's just use that, but it has to be an adapter so we can swap it out later."
 *
 * Server-side only (`posthog-node`). A host loads this subpath lazily, only when its PostHog key is
 * configured, so an install without PostHog never loads the SDK. Wrap the port in
 * `withProductAnalyticsGuards` (`../product`): consent, pseudonymous ids and PII rules live there,
 * once, not in each vendor adapter.
 *
 * Privacy defaults (measured against posthog-node 5.55.1's options): GeoIP enrichment off (the
 * server's IP would otherwise be geolocated as the user's), no exception autocapture (errors belong
 * to the observability port), no feature-flag polling (no personal API key), person profiles only
 * for identified users. The browser side (posthog-js: autocapture, session replay) is NOT here: it
 * needs the visitor/owner cookie consent banner first, see the plan.
 */
import { PostHog, type PostHogOptions } from "posthog-node";

import type { ProductAnalyticsAdapter, ProductAnalyticsPort } from "./index.js";

export interface PostHogConfigEnabled { enabled: true; apiKey: string; host: string; }

export interface PostHogAdapterOptions {
  /** Test seam: a fetch that records batches instead of sending them (no network). */
  fetch?: PostHogOptions["fetch"];
  /** Batch size before a send; tests use 1. */
  flushAt?: number;
}

/**
 * Builds the PostHog-backed port over one private client, plus its teardown.
 * @param required Enabled PostHog configuration (project API key, ingestion host).
 * @param options Optional fetch override and batch size.
 * @returns `{ port, dispose }`; `dispose` flushes and shuts the client down and never throws.
 * @complexity O(1) per event; delivery is batched in the background by the SDK.
 */
export function createPostHogProductAnalyticsAdapter({ config }: { config: PostHogConfigEnabled }, options: PostHogAdapterOptions = {}): ProductAnalyticsAdapter {
  const client = new PostHog(config.apiKey, {
    host: config.host,
    flushAt: options.flushAt ?? 20,
    flushInterval: 10_000,
    disableGeoip: true,
    enableExceptionAutocapture: false,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const port: ProductAnalyticsPort = {
    capture({ name, userId, properties }) {
      client.capture({ distinctId: userId, event: name, ...(properties ? { properties: { ...properties } } : {}) });
    },
    identify({ userId, traits }) {
      client.identify({ distinctId: userId, ...(traits ? { properties: { ...traits } } : {}) });
    },
  };
  return { port, dispose: async () => { try { await client.shutdown(2_000); } catch { /* best-effort */ } } };
}
