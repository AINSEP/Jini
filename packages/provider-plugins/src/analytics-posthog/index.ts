/** `analytics-posthog`: setup only registers the factory; the PostHog client is built when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { createPostHogProductAnalyticsAdapter, type PostHogAdapterOptions } from './posthog.js';
import { attributionOf } from '../attribution.js';
import { postHogBrowserContribution, validatePostHogBrowserConfig } from './browser.js';

const nonEmpty = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
};

/** Accept the explicit profile-less policy without changing existing capture payloads. O(1). */
function personProfileInput({ personProfiles }: Readonly<Record<string, unknown>>, _options = {}): { personProfiles?: 'never' } {
  if (personProfiles === undefined) return {};
  if (personProfiles !== 'never') throw new TypeError('personProfiles must be never when provided');
  return { personProfiles };
}

/**
 * Builds the configured adapter. The host wraps the returned port in `withProductAnalyticsGuards`.
 * @returns `{ port, dispose }`. @throws TypeError on a missing or nonpublishable key or unsafe host.
 */
export function createPostHogProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const config = { enabled: true as const, apiKey: nonEmpty(required.apiKey, 'apiKey'), host: nonEmpty(required.host, 'host'), attribution: attributionOf(required.attribution), includePromptsAndResponses: required.includePromptsAndResponses === 'true', ...personProfileInput(required) };
  validatePostHogBrowserConfig(config);
  const { port, dispose } = createPostHogProductAnalyticsAdapter({ config }, optional as PostHogAdapterOptions);
  return { port: { ...port, browserAnalytics: ({ surface }: { surface: 'site' | 'admin' }, _options = {}) => postHogBrowserContribution({
    apiKey: config.apiKey, host: config.host, sessionReplay: required.sessionReplay === 'true', surface,
    attributes: config.attribution?.attributes.site_id ? { site_id: config.attribution.attributes.site_id } : {},
  }) }, dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => dispose() };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'product_analytics', id: 'posthog', contractVersion: 1, factory: createPostHogProvider });
    },
  },
};
