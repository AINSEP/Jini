/**
 * @file The PostHog adapter for `@jini-ai/analytics/product`'s `ProductAnalyticsPort`, shipped as
 * the `analytics-posthog` provider plugin (moved out of the former `@jini-ai/analytics/product/posthog`
 * subpath 2026-10-25); `posthog-node` is bundled into this artifact only. Owner 2026-10-25: "since
 * PostHog is free, let's just use that, but it has to be an adapter so we can swap it out later."
 *
 * Server-side only (`posthog-node`). A host loads this plugin only when it is installed, enabled and
 * configured with a project key, so an install without PostHog never loads the SDK. The host wraps
 * the port in `withProductAnalyticsGuards` (`@jini-ai/analytics/product`): consent, pseudonymous ids
 * and PII rules live there, once, not in each vendor adapter.
 *
 * Privacy defaults (measured against posthog-node 5.55.1's options): GeoIP enrichment off (the
 * server's IP would otherwise be geolocated as the user's), no exception autocapture (errors belong
 * to the observability port), no feature-flag polling (no personal API key), person profiles only
 * for identified users. Browser autocapture/replay is the optional contribution in browser.ts;
 * the host connects it to its existing visitor/owner consent decisions.
 */
import { PostHog, type PostHogOptions } from "posthog-node";

import type { ProductAnalyticsAdapter, ProductAnalyticsPort } from "@jini-ai/analytics/product";

export interface PostHogConfigEnabled {
  enabled: true; apiKey: string; host: string;
  includePromptsAndResponses?: boolean;
  /** Host attribution on every event: properties that the event cannot override, and `$groups`. */
  attribution?: { readonly attributes: Readonly<Record<string, string>>; readonly groups: Readonly<Record<string, string>> };
}

export interface PostHogAdapterOptions {
  /** Test seam: a fetch that records batches instead of sending them (no network). */
  fetch?: PostHogOptions["fetch"];
  /** Batch size before a send; tests use 1. */
  flushAt?: number;
}

/**
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
  const attributes = config.attribution?.attributes;
  const groups = config.attribution && Object.keys(config.attribution.groups).length ? { ...config.attribution.groups } : undefined;
  const port: ProductAnalyticsPort = {
    includeAiContent: config.includePromptsAndResponses === true,
    captureAiGeneration({ userId, properties, input, output }, _optional: Record<string, never> = {}) {
      // PostHog LLM analytics manual-capture contract (2026-10-25 knowledge; no web fetch):
      // $ai_generation; $ai_latency is seconds, token counters are counts, $ai_total_cost_usd is
      // USD. Unknown counters/costs are omitted, never invented as zero. Trace/span ids here are
      // the normalized recorder's ids, not invented OpenTelemetry SDK context ids.
      const fields: Readonly<Record<string, string>> = {
        model: '$ai_model', provider: '$ai_provider', inputTokens: '$ai_input_tokens',
        outputTokens: '$ai_output_tokens', cacheReadTokens: '$ai_cache_read_input_tokens',
        cacheWriteTokens: '$ai_cache_creation_input_tokens', reasoningTokens: '$ai_reasoning_tokens',
        latencySeconds: '$ai_latency', costUsd: '$ai_total_cost_usd', costSource: 'cost_source',
        traceId: '$ai_trace_id', spanId: '$ai_span_id', isError: '$ai_is_error',
        toolCallCount: 'tool_call_count', ttftSeconds: '$ai_time_to_first_token',
      };
      const mapped = Object.fromEntries(Object.entries(properties).filter(([key]) => Object.hasOwn(fields, key)).map(([key, value]) => [fields[key]!, value]));
      const content = config.includePromptsAndResponses === true ? {
        ...(input === undefined ? {} : { $ai_input: [{ role: 'user', content: input }] }),
        ...(output === undefined ? {} : { $ai_output_choices: [{ role: 'assistant', content: output }] }),
      } : {};
      client.capture({ distinctId: userId, event: '$ai_generation', properties: { ...mapped, ...content, ...attributes, $process_person_profile: false }, ...(groups ? { groups } : {}) });
    },
    capture({ name, userId, properties }) {
      // Domain/outbox IDs are the host-neutral idempotency key; retries retain vendor dedupe.
      const merged = { ...properties, ...attributes, ...(typeof properties?.eventId === 'string' ? { $insert_id: properties.eventId } : {}) };
      client.capture({ distinctId: userId, event: name, ...(Object.keys(merged).length ? { properties: merged } : {}), ...(groups ? { groups } : {}) });
    },
    // Sent as the `$identify` event itself rather than `client.identify` (Codex fix-lane MED): the SDK's
    // identify puts traits under `$set` and nothing else on the event, so it could carry neither the
    // site attribution nor `$groups`. Traits set person properties, minus the keys the host attributes.
    identify({ userId, traits }) {
      const set = Object.fromEntries(Object.entries(traits ?? {}).filter(([key]) => !attributes || !Object.hasOwn(attributes, key)));
      const properties = { ...(Object.keys(set).length ? { $set: set } : {}), ...attributes };
      client.capture({ distinctId: userId, event: "$identify", ...(Object.keys(properties).length ? { properties } : {}), ...(groups ? { groups } : {}) });
    },
  };
  return { port, dispose: async () => { try { await client.shutdown(2_000); } catch { /* best-effort */ } } };
}
