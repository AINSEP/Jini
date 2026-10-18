import type { Express, RequestHandler } from 'express';
import { createConsoleLogger, type Logger } from '@jini-ai/core/primitives';

/** Log request completions only when explicitly enabled, either all or above a threshold.
 * Structured sinks retain correlation fields; the default console gets only the compact message.
 * Missing or invalid thresholds disable slow logging; zero is supported. Duration must exceed it.
 * Callers supply elapsed monotonic time and bounded route patterns, never raw request data.
 * @complexity O(1) per completion, excluding the injected logger.
 */
export function logCompletedRequest(
  required: { requestId: string; method: string; routePattern: string; statusCode: number; durationMs: number },
  { logger, logRequests = false, slowRequestMs }: {
    logger?: Pick<Logger, 'info'>; logRequests?: boolean; slowRequestMs?: number;
  } = {},
): void {
  const logSlowRequest = slowRequestMs !== undefined && Number.isFinite(slowRequestMs)
    && slowRequestMs >= 0 && required.durationMs > slowRequestMs;
  if (!logRequests && !logSlowRequest) return;
  const { statusCode, method, routePattern, durationMs, requestId } = required;
  const message = `http ${statusCode} ${method} ${routePattern} ${Math.round(durationMs)}ms req=${requestId}`;
  if (logger) logger.info({ message }, { meta: { ...required } });
  else createConsoleLogger({ prefix: '' }).info({ message });
}

/** Structural port satisfied by diagnostics/observability, with host-owned logging and tracing. */
export interface HttpRequestObservabilityPort {
  trackRequest(required: { method: string; path: string }): {
    end(required: { statusCode: number; routePattern: string }): void;
  };
}

/** Track requests before routing and read the mount-aware route pattern at response completion.
 * Unmatched paths use a fixed label so attacker-selected paths do not become metric labels.
 * Each response completes its tracker once; hook error policy belongs to the injected adapter.
 * @complexity O(1) per request, excluding injected hooks and Express routing.
 */
export function createRequestTrackingMiddleware({ observability }: { observability: HttpRequestObservabilityPort }): RequestHandler {
  return (req, res, next) => {
    const tracker = observability.trackRequest({ method: req.method, path: req.path });
    res.once('finish', () => {
      const routePattern = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      tracker.end({ statusCode: res.statusCode, routePattern });
    });
    next();
  };
}

/** Mount first, before serving gates and routes, so refusals and unmatched requests are measured.
 * @complexity O(1) registration; effects are restricted to Express middleware registration.
 */
export function applyRequestTracking({ app, observability }: { app: Express; observability: HttpRequestObservabilityPort }): void {
  app.use(createRequestTrackingMiddleware({ observability }));
}
