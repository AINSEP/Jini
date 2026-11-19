import { useEffect, useMemo } from 'react';
import { toRouteTemplate } from '../../browser/route-template.js';
import type { BrowserTelemetry } from '../../browser/telemetry.js';

/**
 * Feeds session state and route templates to telemetry. Signing in on the same route counts as
 * arriving there, so the effect also re-runs on signedIn; unrelated renders send nothing.
 */
export function useBrowserTelemetryFeed(
  { signedIn, routePath, params, base, telemetry }: {
    signedIn: boolean; routePath: string; params: Readonly<Record<string, string>>; base: string;
    telemetry: Pick<BrowserTelemetry, 'setSignedIn' | 'setRoute'>;
  },
  _optional: Record<string, never> = {},
): void {
  const route = useMemo(() => toRouteTemplate({ base, routePath, params }), [base, routePath, params]);
  useEffect(() => {
    telemetry.setSignedIn(signedIn);
    telemetry.setRoute(route);
  }, [telemetry, signedIn, route]);
}
