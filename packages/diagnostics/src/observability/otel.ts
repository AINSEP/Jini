import type { ObservabilityConfigEnabled } from './config.js';
import type { ExporterFactory, TracerProviderFactory, ObservabilityPort } from './ports.js';
export interface OtelAdapterDependencies {
 config: ObservabilityConfigEnabled; exporterFactory: ExporterFactory; tracerProviderFactory: TracerProviderFactory;
}
/** Builds request spans through injected provider/exporter factories. Hosts wrap their SDK here.
 * @param required Explicit config and structural factories.
 * @returns One adapter whose request spans end once, with the final route name and status.
 * @throws Provider/exporter errors propagate during setup. No globals or SDK imports are used.
 */
export function createOtelObservabilityPort({ config, exporterFactory, tracerProviderFactory }: OtelAdapterDependencies): ObservabilityPort {
 const exporter = exporterFactory.create({ endpoint: config.endpoint });
 const provider = tracerProviderFactory.create({ serviceName: config.serviceName, exporter });
 const tracer = provider.getTracer({ name: config.tracerName });
 return { trackRequest(input) {
  const span = tracer.startSpan({ name: input.method, kind: 'server', attributes: { 'http.method': input.method, 'http.target': input.path } });
  let ended = false;
  return { end(outcome) {
   if (ended) return; ended = true;
   // Routing finishes after startSpan, so open with a provisional name and assign the final
   // pattern at end. The consumer port needs no separate rename operation to express that timing.
   span.updateName({ name: `${input.method} ${outcome.routePattern}` });
   span.setAttribute({ name: 'http.route', value: outcome.routePattern });
   span.setAttribute({ name: 'http.status_code', value: outcome.statusCode });
   if (outcome.statusCode >= 500) span.setStatus({ code: 'error' });
   span.end({});
  } };
 } };
}
