import type { ObservabilityPort, RequestTracker } from './ports.js';
const NOOP_TRACKER: RequestTracker = Object.freeze({ end(): void {} });
/** Creates disabled telemetry; every request shares one frozen tracker without allocation. */
export function createNoopObservabilityPort(_required: Record<string, never>): ObservabilityPort {
 return { trackRequest: () => NOOP_TRACKER };
}
