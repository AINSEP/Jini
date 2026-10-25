/** `analytics-posthog`: setup only registers the factory; the PostHog client is built when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { createPostHogProductAnalyticsAdapter, type PostHogAdapterOptions } from './posthog.js';

const nonEmpty = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
};

/**
 * Builds the configured adapter. The host wraps the returned port in `withProductAnalyticsGuards`.
 * @param required `{ apiKey, host }`: the project API key and the ingestion host URL.
 * @param optional `{ fetch?, flushAt? }` test seams.
 * @returns `{ port, dispose }`. @throws TypeError on a missing key or host.
 */
export function createPostHogProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const config = { enabled: true as const, apiKey: nonEmpty(required.apiKey, 'apiKey'), host: nonEmpty(required.host, 'host') };
  const { port, dispose } = createPostHogProductAnalyticsAdapter({ config }, optional as PostHogAdapterOptions);
  return { port, dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => dispose() };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'product_analytics', id: 'posthog', contractVersion: 1, factory: createPostHogProvider });
    },
  },
};
