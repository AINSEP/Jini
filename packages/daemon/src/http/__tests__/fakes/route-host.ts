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

/** One incident as the host's reporter saw it: the route's report, its log source and the request ID it answered with. */
export type RecordedIncident = { readonly error: unknown; readonly correlationId: string; readonly logSource: string } & Record<string, unknown>;

/**
 * @param optional.originPolicy - Who counts as same-origin; everyone by default.
 * @param optional.recordIncident - Told of every incident the injected reporter takes, as one flat record.
 * @param optional.jsonBodyMaxBytes - The host's body limit; 1 MiB by default.
 */
export function fakeDaemonRouteHost(
  _required: Record<string, never> = {},
  { originPolicy, onInternalError, recordIncident, jsonBodyMaxBytes = 1024 * 1024 }: { readonly originPolicy?: SameOriginPolicyPort; readonly onInternalError?: RouteHostContext['onInternalError']; readonly recordIncident?: ((incident: never) => void) | undefined; readonly jsonBodyMaxBytes?: number } = {},
): FakeDaemonRouteHost {
  const reports: Array<FakeDaemonRouteHost['reports'][number]> = [];
  // Reporter mode: the host's one reporter owns each incident, so a second argument is never consulted.
  const reportInternalError: ReportRouteInternalError = ({ report, logSource, message }) => {
    const requestId = `req-${reports.length + 1}`;
    reports.push({ report, logSource, message, requestId });
    (recordIncident as ((incident: RecordedIncident) => void) | undefined)?.({ ...report, correlationId: requestId, logSource });
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

const recordingHosts = new WeakMap<ReportRouteInternalError, FakeDaemonRouteHost>();

/** A recording `reportInternalError` port a test injects through deps: each incident reaches `record` as one flat record. It is remembered so {@link withInjectedReporter} can put it in charge of a served host. */
export function injectedRecordingReporter({ record }: { readonly record: (incident: never) => void }, _optional: Record<string, never> = {}): ReportRouteInternalError {
  const host = fakeDaemonRouteHost({}, { recordIncident: record });
  recordingHosts.set(host.reportInternalError, host);
  return host.reportInternalError;
}

/**
 * The host a served test mounts: when the test's deps carry a reporter made by {@link injectedRecordingReporter},
 * that reporter (and its `reports`) stands in for the host's, as a real host injects its one reporter.
 */
export function withInjectedReporter<H extends FakeDaemonRouteHost>({ host, deps }: { readonly host: H; readonly deps: object }, _optional: Record<string, never> = {}): H {
  const injected = (deps as { readonly reportInternalError?: ReportRouteInternalError }).reportInternalError;
  const recording = injected === undefined ? undefined : recordingHosts.get(injected);
  return recording === undefined ? host : { ...host, reportInternalError: recording.reportInternalError, reports: recording.reports };
}
