/**
 * @file The host a daemon route group is given in tests: every port is a recorder or is driven by
 * hand, so a test states what the host answers and reads back what the routes asked of it.
 * Not published.
 */
import type { ReportRouteInternalError, RouteHostContext, SameOriginPolicyPort, SseSchedulerPort } from '@jini-ai/core/contracts/server';
import { createTestRouteHost, fakeTimingSafeEqual, type RecordingTimingSafeEqual } from '@jini-ai/core/contracts/server/testing';
import type { DaemonRouteHost } from '../../route-host.js';

/** Timers that fire only when the test says so. */
export interface ManualScheduler extends SseSchedulerPort {
  /** Moves time forward by `ms`, firing each timer once per whole interval it has reached, in scheduling order. */
  advance(ms: number): void;
  /** How many timers are scheduled and not cancelled. */
  readonly pending: number;
}

export function createManualScheduler(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): ManualScheduler {
  const timers = new Map<number, { callback: () => void; intervalMs: number; elapsed: number }>();
  let nextHandle = 1;
  return {
    every: ({ callback, intervalMs }) => {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { callback, intervalMs, elapsed: 0 });
      return handle;
    },
    cancel: ({ handle }) => { timers.delete(handle as number); },
    advance: (ms) => {
      for (const [handle, timer] of [...timers]) {
        timer.elapsed += ms;
        while (timers.has(handle) && timer.elapsed >= timer.intervalMs) {
          timer.elapsed -= timer.intervalMs;
          timer.callback();
        }
      }
    },
    get pending() { return timers.size; },
  };
}

export interface FakeDaemonRouteHost extends DaemonRouteHost {
  readonly scheduler: ManualScheduler;
  readonly timingSafeEqual: RecordingTimingSafeEqual;
  /** Every internal error the routes reported, oldest first. */
  readonly reports: readonly { readonly report: { readonly error: unknown }; readonly logSource: string; readonly message: string; readonly requestId: string }[];
}

/**
 * @param optional.originPolicy - Who counts as same-origin; everyone by default.
 * @param optional.jsonBodyMaxBytes - The host's body limit; 1 MiB by default.
 */
export function fakeDaemonRouteHost(
  _required: Record<string, never> = {},
  { originPolicy, onInternalError, jsonBodyMaxBytes = 1024 * 1024 }: { readonly originPolicy?: SameOriginPolicyPort; readonly onInternalError?: RouteHostContext['onInternalError']; readonly jsonBodyMaxBytes?: number } = {},
): FakeDaemonRouteHost {
  const reports: Array<FakeDaemonRouteHost['reports'][number]> = [];
  const reportInternalError: ReportRouteInternalError = ({ report, logSource, message }, optional = {}) => {
    const requestId = `req-${reports.length + 1}`;
    reports.push({ report, logSource, message, requestId });
    optional.onInternalError?.({ ...report, correlationId: requestId, logSource });
    return { code: 'INTERNAL_ERROR', message, requestId };
  };
  return {
    context: createTestRouteHost({}, { ...(originPolicy ? { originPolicy } : {}), ...(onInternalError ? { onInternalError } : {}) }),
    reportInternalError,
    scheduler: createManualScheduler(),
    timingSafeEqual: fakeTimingSafeEqual(),
    jsonBodyMaxBytes,
    reports,
  };
}
