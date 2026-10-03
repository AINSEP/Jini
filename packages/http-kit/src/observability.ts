import type { Express, RequestHandler } from 'express';

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
