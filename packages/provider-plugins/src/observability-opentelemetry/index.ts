/** `observability-opentelemetry`: setup only registers the factory; the SDK provider starts when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { resolveObservabilityConfig } from '@jini-ai/diagnostics/observability';
import { createOtelObservabilityAdapter, type OtelAdapterOptions } from './opentelemetry.js';

const text = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
};

/** Generic OTLP headers (a collector's auth header), never a vendor-specific option. */
function headersOf(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('headers must be an object of strings');
  const entries = Object.entries(value);
  if (entries.some(([, header]) => typeof header !== 'string')) throw new TypeError('headers must be an object of strings');
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Builds the configured adapter. Hosts select this plugin only when an endpoint is configured.
 * @param required `{ serviceName, tracerName, endpoint? , tracesEndpoint?, headers? }`; credentials ride `headers`.
 * @param optional `{ spanProcessors? }` test seam.
 * @returns `{ port, dispose }`. @throws TypeError on missing endpoint or malformed input.
 */
export function createOpenTelemetryProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const endpoint = text(required.endpoint, 'endpoint');
  const tracesEndpoint = text(required.tracesEndpoint, 'tracesEndpoint');
  const config = resolveObservabilityConfig({
    serviceName: text(required.serviceName, 'serviceName') ?? '', tracerName: text(required.tracerName, 'tracerName') ?? '',
  }, { ...(endpoint === undefined ? {} : { endpoint }), ...(tracesEndpoint === undefined ? {} : { tracesEndpoint }) });
  if (!config.enabled) throw new TypeError('an OTLP endpoint is required');
  const headers = headersOf(required.headers);
  const spanProcessors = optional.spanProcessors as OtelAdapterOptions['spanProcessors'];
  const options: OtelAdapterOptions = { ...(headers ? { headers } : {}), ...(spanProcessors ? { spanProcessors } : {}) };
  const { port, dispose } = createOtelObservabilityAdapter({ config }, options);
  return { port, dispose: (_required: Record<string, never>, _optional: Record<string, never> = {}) => dispose() };
}

export default {
  definition: {
    setup(sdk: PluginSdk): void {
      sdk.providers.register({ contract: 'observability', id: 'opentelemetry', contractVersion: 1, factory: createOpenTelemetryProvider });
    },
  },
};
