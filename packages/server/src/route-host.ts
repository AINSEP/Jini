/**
 * @file The host object this preset hands every daemon route group. A route group returns its
 * routes as data and takes everything it needs from the process through this one object; the
 * preset is a Node host, so the timers, the constant-time compare and the request-ID source are
 * bound to Node here, once per composed kernel.
 */
import { timingSafeEqual } from 'node:crypto';
import type { RouteHostContext, SseSchedulerPort } from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost, FrontendSessionTimer } from '@jini-ai/daemon/http';
import { reportRouteInternalError } from '@jini-ai/http-kit';
import { maxReserializedJsonBytes } from '@jini-ai/http-kit/node-bridge';

/** The byte limit of the JSON parser this preset installs (`express.json()` with its default of 100 KB). */
export const PRESET_JSON_PARSER_LIMIT_BYTES = 102_400;

/** Keepalive timers on Node's clock. Unref'd: an idle stream must not keep the process alive. */
const nodeIntervalScheduler: SseSchedulerPort = {
  every: ({ callback, intervalMs }) => { const timer = setInterval(callback, intervalMs); timer.unref(); return timer; },
  cancel: ({ handle }) => { clearInterval(handle as NodeJS.Timeout); },
};

/** A one-shot timer on Node's clock for a frontend session's expiry. Unref'd: a pending expiry must not keep the process alive. */
export const nodeSessionTimer: FrontendSessionTimer = ({ callback, delayMs }) => {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return { cancel: () => { clearTimeout(timer); } };
};

/**
 * The host object for every daemon route group of one composed kernel.
 * @param required.context - The same-origin policy and incident sink the composition was given.
 * @param required.parserLimitBytes - The byte limit of the JSON parser mounted above the routes. A route re-reads the body that parser produced, and re-serialized JSON can be up to 5.25 times longer (a number such as `1e20` prints as 21 digits), so the routes' own limit is derived from it; the parser's limit stays the effective one.
 */
export function presetRouteHost(required: { readonly context: RouteHostContext; readonly parserLimitBytes: number }, _optional: Record<string, never> = {}): DaemonRouteHost {
  return {
    context: required.context,
    reportInternalError: reportRouteInternalError,
    scheduler: nodeIntervalScheduler,
    // The constant-time compare itself. Routes reach it only through core's `timingSafeTokenMatch`, which compares lengths first.
    timingSafeEqual: ({ left, right }) => timingSafeEqual(left, right),
    jsonBodyMaxBytes: maxReserializedJsonBytes({ parserLimitBytes: required.parserLimitBytes }),
  };
}
