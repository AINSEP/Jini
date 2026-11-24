/**
 * @file The window-level error lifecycle a UI shell installs once: `error` and `unhandledrejection`
 * listeners that turn whatever was thrown into a capped `{ message, stack }` pair and hand it to a
 * host-supplied `report`. The host owns the vocabulary (payload kind, channel, bridge); this module
 * owns only the capping, the fallback text and the teardown. Only the universal `EventTarget`/`Event`
 * globals are used (no DOM lib), so a `Window`, a bare `EventTarget` or a test fake all fit.
 */

/** Anything with `addEventListener`/`removeEventListener` — a `Window` in a real shell. */
export type GlobalErrorTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** One captured failure, already capped. Never DOM text, URLs or arguments: only what was thrown. */
export interface GlobalErrorReport {
  readonly message: string;
  readonly stack: string;
}

export interface GlobalErrorReportingArgs {
  readonly target: GlobalErrorTarget;
  /** The host's sink; it must not throw (wrap the bridge call), or a broken IPC would recurse. */
  readonly report: (required: GlobalErrorReport, optional?: Record<string, never>) => void;
}

export interface GlobalErrorReportingOptions {
  readonly maxMessageLength?: number;
  readonly maxStackLength?: number;
  /** Message for a rejection whose reason is not a string or an `Error`. */
  readonly rejectionFallback?: string;
}

interface ErrorEventLike { readonly error?: unknown; readonly message?: string }
interface RejectionEventLike { readonly reason?: unknown }

/**
 * Install once at boot, before the UI mounts. Native browser events retain normal handling: the
 * listeners never call `preventDefault`, so the console still shows the failure.
 * @returns Teardown for host/tests. @complexity O(n) capped error text, two listeners only.
 */
export function installGlobalErrorReporting(
  required: GlobalErrorReportingArgs,
  { maxMessageLength = 1000, maxStackLength = 8000, rejectionFallback = 'Unhandled rejection' }: GlobalErrorReportingOptions = {},
): () => void {
  const { target, report } = required;
  const send = ({ failure, fallback }: { failure: unknown; fallback: string }, _options = {}) => {
    const message = typeof failure === 'string' ? failure : fallback;
    const error = failure instanceof Error ? failure : new Error(message);
    report({ message: error.message.slice(0, maxMessageLength), stack: (error.stack ?? '').slice(0, maxStackLength) });
  };
  const onError = (event: Event) => {
    const { error, message } = event as Event & ErrorEventLike;
    send({ failure: error, fallback: message ?? '' });
  };
  const onRejection = (event: Event) => send({ failure: (event as Event & RejectionEventLike).reason, fallback: rejectionFallback });
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
