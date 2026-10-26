/** `observability-opentelemetry`: setup only registers the factory; the SDK provider starts when a host initializes it. */
import type { PluginSdk } from '@jini-ai/plugins/host';
import { resolveObservabilityConfig } from '@jini-ai/diagnostics/observability';
import { createOtelObservabilityAdapter, type OtelAdapterOptions } from './opentelemetry.js';
import { attributionOf } from '../attribution.js';

const text = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
};

const HEADER_PAIR = /^([^=\s][^=]*?)\s*=\s*(.+)$/;

/** The OTLP text form a settings card holds (`Name=Value,Name=Value`, as in the OTLP exporter spec). */
function headersFromText(value: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const pairs = value.split(',').map((pair) => HEADER_PAIR.exec(pair.trim()));
  if (pairs.some((pair) => !pair)) throw new TypeError('headers must be Name=Value pairs separated by commas');
  return Object.fromEntries(pairs.map((pair) => [pair![1]!, pair![2]!.trim()]));
}

/** Generic OTLP headers (a collector's auth header), never a vendor-specific option: an object, or the card's text form. */
export function otlpHeadersOf(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return headersFromText(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('headers must be an object of strings');
  const entries = Object.entries(value);
  if (entries.some(([, header]) => typeof header !== 'string')) throw new TypeError('headers must be an object of strings');
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * The card's generic OTLP auth: `token` alone → `Authorization: Bearer <token>`; with `username` (a
 * Grafana Cloud instance ID, a collector user) → `Authorization: Basic base64(username:token)`. Built
 * here so nobody hand-encodes base64. It replaces any `Authorization` in the extra `headers`; with no
 * token, those headers (a card saved before these fields existed) apply unchanged. Explicit
 * `auth: 'none'` ignores the token and removes Authorization from extra headers too.
 */
export function otlpAuthHeaders({ auth, username, token, headers }: { auth?: string | undefined; username?: string | undefined; token?: string | undefined; headers?: Record<string, string> | undefined }, _optional: Record<string, never> = {}): Record<string, string> | undefined {
  if (auth === 'none') return headers && Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'));
  if (!token?.trim()) return headers;
  const authorization = username?.trim() ? `Basic ${Buffer.from(`${username.trim()}:${token.trim()}`).toString('base64')}` : `Bearer ${token.trim()}`;
  const extra = Object.entries(headers ?? {}).filter(([name]) => name.toLowerCase() !== 'authorization');
  return { ...Object.fromEntries(extra), Authorization: authorization };
}

/**
 * Builds the configured adapter. Hosts select this plugin only when an endpoint is configured.
 * @param required `{ serviceName, tracerName?, endpoint?, tracesEndpoint?, auth?, username?, token?, headers? }`; credentials are
 *   `token` (+ `username`; see {@link otlpAuthHeaders}) and/or `headers` (object or the card's `Name=Value,…` text). `tracerName` defaults to `serviceName`. `attribution.attributes`
 *   (host-named, e.g. which site) go on every span's resource.
 * @param optional `{ spanProcessors? }` test seam.
 * @returns `{ port, dispose }`. @throws TypeError on missing endpoint or malformed input.
 */
export function createOpenTelemetryProvider(required: Readonly<Record<string, unknown>>, optional: Readonly<Record<string, unknown>> = {}) {
  const endpoint = text(required.endpoint, 'endpoint');
  const tracesEndpoint = text(required.tracesEndpoint, 'tracesEndpoint');
  const serviceName = text(required.serviceName, 'serviceName');
  const config = resolveObservabilityConfig({
    serviceName: serviceName ?? '', tracerName: text(required.tracerName, 'tracerName') ?? serviceName ?? '',
  }, { ...(endpoint === undefined ? {} : { endpoint }), ...(tracesEndpoint === undefined ? {} : { tracesEndpoint }) });
  if (!config.enabled) throw new TypeError('an OTLP endpoint is required');
  const headers = otlpAuthHeaders({ auth: text(required.auth, 'auth'), username: text(required.username, 'username'), token: text(required.token, 'token'), headers: otlpHeadersOf(required.headers) });
  const spanProcessors = optional.spanProcessors as OtelAdapterOptions['spanProcessors'];
  const resourceAttributes = attributionOf(required.attribution).attributes;
  const options: OtelAdapterOptions = { ...(headers ? { headers } : {}), ...(spanProcessors ? { spanProcessors } : {}), resourceAttributes,
    reportTelemetry: optional.reportTelemetry as OtelAdapterOptions['reportTelemetry'], info: optional.info as OtelAdapterOptions['info'] };
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
