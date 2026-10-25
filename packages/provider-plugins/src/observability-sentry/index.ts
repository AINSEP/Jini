/** `observability-sentry`: setup only registers the factory; the private client is built when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { createSentryObservabilityAdapter, type SentryAdapterOptions } from './sentry.js';

/**
 * Builds the configured adapter. Hosts select this plugin only when a DSN is configured.
 * @param required `{ dsn, environment?, tracesSampleRate? }` (rate defaults to 0: errors only).
 * @param optional `{ client?, transport? }`: a host-owned client to reuse, or a test transport.
 * @returns `{ port, dispose }`. @throws TypeError on a missing DSN or an out-of-range rate.
 */
export function createSentryProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const { dsn, environment, tracesSampleRate = 0 } = required;
  if (typeof dsn !== 'string' || !dsn.trim()) throw new TypeError('dsn must be a non-empty string');
  if (environment !== undefined && typeof environment !== 'string') throw new TypeError('environment must be a string');
  if (typeof tracesSampleRate !== 'number' || !(tracesSampleRate >= 0 && tracesSampleRate <= 1)) throw new TypeError('tracesSampleRate must be within 0..1');
  const config = { enabled: true as const, dsn: dsn.trim(), tracesSampleRate, ...(environment ? { environment } : {}) };
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
