import type { ObservabilityConfig } from './config.js';
import type { ExporterFactory, TracerProviderFactory, ObservabilityPort } from './ports.js';
import { createNoopObservabilityPort } from './noop.js';
import { createOtelObservabilityPort, type OtelAdapterOptions } from './otel.js';
export * from './config.js';
export * from './ports.js';
export * from './noop.js';
export * from './otel.js';
export * from './hooks.js';
export * from './instrumentation.js';

/** Selects an adapter from explicit config; disabled telemetry never invokes either factory.
 * @param options Adapter options (host span scope); ignored when telemetry is disabled. */
export function createObservabilityPort(
 { config, exporterFactory, tracerProviderFactory }: { config: ObservabilityConfig; exporterFactory: ExporterFactory; tracerProviderFactory: TracerProviderFactory },
 options: OtelAdapterOptions = {},
): ObservabilityPort {
 if (!config.enabled) return createNoopObservabilityPort({});
 return createOtelObservabilityPort({ config, exporterFactory, tracerProviderFactory }, options);
}
