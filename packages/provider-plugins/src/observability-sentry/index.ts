/** `observability-sentry`: setup only registers the factory; the private client is built when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { attributionOf } from '../attribution.js';
import { createSentryObservabilityAdapter, type SentryAdapterOptions } from './sentry.js';

/**
 * Builds the configured adapter. Hosts select this plugin only when a DSN is configured.
 * The rate defaults to 0: errors only.
 *   The host's attribution attributes become tags on every event and transaction; a blank
 *   `environment` defaults to its `deployment.environment`.
 * @param optional `{ client?, transport? }`: a host-owned client to reuse, or a test transport.
 * @returns `{ port, dispose }`. @throws TypeError on invalid card fields or a malformed attribution.
 */
export function createSentryProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const { dsn, environment = '', tracesSampleRate = 0 } = required;
  if (typeof dsn !== 'string' || !dsn.trim()) throw new TypeError('dsn must be a non-empty string');
  if (typeof environment !== 'string') throw new TypeError('environment must be a string');
  if (typeof tracesSampleRate !== 'number' || !(tracesSampleRate >= 0 && tracesSampleRate <= 1)) throw new TypeError('tracesSampleRate must be within 0..1');
  const tags = attributionOf(required.attribution).attributes;
  const resolvedEnvironment = environment || tags['deployment.environment'];
  const config = { enabled: true as const, dsn: dsn.trim(), tracesSampleRate, tags, ...(resolvedEnvironment ? { environment: resolvedEnvironment } : {}) };
  const { port, dispose } = createSentryObservabilityAdapter({ config }, optional as SentryAdapterOptions);
  return { port, dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => dispose() };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'observability', id: 'sentry', contractVersion: 1, factory: createSentryProvider });
    },
  },
};
