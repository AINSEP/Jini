/**
 * @file What a host hands every daemon route group. A route group is a function that returns its
 * routes as data; everything it needs from the process it runs in (who counts as same-origin, how
 * an internal error is reported, timers, the constant-time compare, how large a JSON body may be)
 * arrives through this one object, which the host builds once per listener.
 */
import type { TimingSafeByteComparison } from '@jini-ai/core';
import type { ReportRouteInternalError, RouteHostContext, SseSchedulerPort } from '@jini-ai/core/contracts/server';

/** Every field is required: the daemon has no default for any of them, so a host that forgets one fails to compile. */
export interface DaemonRouteHost {
  /** Same-origin policy and the incident sink. */
  readonly context: RouteHostContext;
  /** Turns an internal failure into the answer a client may see: it makes the request ID and writes the log line. */
  readonly reportInternalError: ReportRouteInternalError;
  /** Timers for stream keepalives. Tests pass one they tick by hand. */
  readonly scheduler: SseSchedulerPort;
  /** Constant-time compare of two equal-length byte arrays (a Node host binds `node:crypto.timingSafeEqual`). Used only through core's `timingSafeTokenMatch`, which checks the lengths first. */
  readonly timingSafeEqual: TimingSafeByteComparison;
  /**
   * Largest JSON body a daemon route reads. A host with its own parser in front passes a value
   * large enough never to refuse a body that parser accepted (the body is re-serialized on the
   * way, which can make it longer); the parser's limit stays the effective one.
   */
  readonly jsonBodyMaxBytes: number;
}
