/**
 * @file The host object this preset hands every daemon route group. A route group returns its
 * routes as data and takes everything it needs from the process through this one object; the
 * preset is a Node host, so the timers, the constant-time compare and the request-ID source are
 * bound to Node here, once per composed kernel.
 */
import { timingSafeEqual } from 'node:crypto';
import type { ReportRouteInternalError, RouteHostContext, SseSchedulerPort } from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost, FrontendSessionTimer } from '@jini-ai/daemon/http';
import { createReporterRouteInternalError, reportRouteInternalError } from '@jini-ai/http-kit';
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
 * The in-route incident reporter matching the context's mode. With `errors` the host's reporter owns
 * the one record and error ID, so a route that handles its own failure and returns `INTERNAL_ERROR`
 * agrees with a route that throws; without it the legacy SEC-005 sink path stays exactly as it was.
 */
function internalErrorReporterFor({ context }: { readonly context: RouteHostContext }): ReportRouteInternalError {
  return context.errors ? createReporterRouteInternalError({ reporter: context.errors.reporter }) : reportRouteInternalError;
}

/**
 * The host object for every daemon route group of one composed kernel.
 * @param required.context - The same-origin policy and incident sink the composition was given. Its `errors`, when present, puts the in-route incident reporter in reporter mode.
 * @param required.parserLimitBytes - The byte limit of the JSON parser mounted above the routes. A route re-reads the body that parser produced, and re-serialized JSON can be up to 5.25 times longer (a number such as `1e20` prints as 21 digits), so the routes' own limit is derived from it; the parser's limit stays the effective one.
 */
export function presetRouteHost(required: { readonly context: RouteHostContext; readonly parserLimitBytes: number }, _optional: Record<string, never> = {}): DaemonRouteHost {
  return {
    context: required.context,
    reportInternalError: internalErrorReporterFor({ context: required.context }),
    scheduler: nodeIntervalScheduler,
    // The daemon's Node binding for core's injected constant-time byte comparison (moved here from the
    // deleted daemon `http/node-timing-safe-equal.ts`). Core's `timingSafeTokenMatch` takes the comparison as a
    // port so the universal kernel imports no Node; a daemon gate uses this, never `===` (a plain compare
    // short-circuits on the first differing byte and leaks the matching prefix length).
    // `node:crypto`'s constant-time comparison, adapted to core's object-argument port.
    // The constant-time compare itself. Routes reach it only through core's `timingSafeTokenMatch`, which compares lengths first.
    timingSafeEqual: ({ left, right }) => timingSafeEqual(left, right),
    jsonBodyMaxBytes: maxReserializedJsonBytes({ parserLimitBytes: required.parserLimitBytes }),
  };
}
