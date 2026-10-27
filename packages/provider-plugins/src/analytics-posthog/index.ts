/** `analytics-posthog`: setup only registers the factory; the PostHog client is built when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { createPostHogProductAnalyticsAdapter, type PostHogAdapterOptions } from './posthog.js';
import { attributionOf } from '../attribution.js';
import { postHogBrowserContribution } from './browser.js';
import { postHogConsentContribution, validatePostHogBrowserConfig } from './consent.js';
import { postHogBrowserAttributes } from './consent-adapter.js';

const nonEmpty = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
};

/**
 * Builds the configured adapter. The host wraps the returned port in `withProductAnalyticsGuards`.
 * @returns `{ port, dispose }`. @throws TypeError on a missing or nonpublishable key or unsafe host.
 */
export function createPostHogProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const config = { enabled: true as const, apiKey: nonEmpty(required.apiKey, 'apiKey'), host: nonEmpty(required.host, 'host'), attribution: attributionOf(required.attribution), includePromptsAndResponses: required.includePromptsAndResponses === 'true' };
  validatePostHogBrowserConfig(config);
  const { port, dispose } = createPostHogProductAnalyticsAdapter({ config }, optional as PostHogAdapterOptions);
  const sessionReplay = required.sessionReplay === 'true';
  const attributes = postHogBrowserAttributes({ attributes: config.attribution.attributes });
  return { port: { ...port, browserAnalytics: ({ surface }: { surface: 'site' | 'admin' }, _options = {}) => postHogBrowserContribution({
    apiKey: config.apiKey, host: config.host, sessionReplay, surface, attributes,
  }),
  /** Cookie-consent adapter for public pages; the host picks the same-origin mount path. */
  consentAdapter: ({ path }: { path: string }, _options = {}) => postHogConsentContribution({ apiKey: config.apiKey, host: config.host, sessionReplay,
    siteId: attributes.site_id, release: attributes.release, environment: attributes.environment, path }),
  }, dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => dispose() };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'product_analytics', id: 'posthog', contractVersion: 1, factory: createPostHogProvider });
    },
  },
};
