export interface ObservabilityConfigDisabled { enabled: false; }
export interface ObservabilityConfigEnabled {
 enabled: true; serviceName: string; tracerName: string; endpoint: string;
}
export type ObservabilityConfig = ObservabilityConfigDisabled | ObservabilityConfigEnabled;

/** Resolves explicit OTLP settings. Traces endpoint wins; general endpoint gets /v1/traces.
 * @param required Caller-owned service and tracer identity.
 * @param options Explicit endpoints; absence disables telemetry.
 * @returns Enabled configuration or the disabled variant. Never reads environment or globals.
 * @throws TypeError when enabled identities are blank.
 */
export function resolveObservabilityConfig(
 { serviceName, tracerName }: { serviceName: string; tracerName: string },
 { endpoint, tracesEndpoint }: { endpoint?: string; tracesEndpoint?: string } = {},
): ObservabilityConfig {
 const traces = tracesEndpoint?.trim(); const base = endpoint?.trim();
 // Endpoint presence is the opt-in; a host without collector configuration stays off by default.
 if (!traces && !base) return { enabled: false };
 if (!serviceName.trim()) throw new TypeError('serviceName must be non-empty');
 if (!tracerName.trim()) throw new TypeError('tracerName must be non-empty');
 // A signal-specific endpoint already names its route; the general endpoint needs /v1/traces.
 // Treating the general endpoint as complete would send traces to the collector's wrong route.
 return { enabled: true, serviceName: serviceName.trim(), tracerName: tracerName.trim(), endpoint: traces || `${base!.replace(/\/+$/, '')}/v1/traces` };
}
