import type { Request, Response } from "express";
import type { Authorize, SettingsChangeFeed, SettingsHttpOptions, Scheduler } from "./contracts.js";

interface StreamRequired {
  request: Request; response: Response; workspaceId: string; principalId: string;
  changeFeed: SettingsChangeFeed; authorize: Authorize; permission: string; scheduler: Scheduler;
  onClose: (required: { close: () => void }) => void;
  isDisposed: () => boolean;
}

/** Starts after HTTP authorization. All scheduling and storage are injected. */
/** Poll with bounded pages, tenant-scoped ids and retryable reads; close cancels all schedules.
 * O(page size) per tick and O(1) connection state; repository effects live behind the feed port.
 * Invalid scheduler intervals/page sizes throw RangeError before opening; initial read errors propagate.
 */
export async function openSettingsChangeStream(required: StreamRequired, optional: SettingsHttpOptions = {}): Promise<() => void> {
  const { request, response, workspaceId, principalId, changeFeed, scheduler } = required;
  const pageSize = optional.revisionPageSize ?? 200;
  const intervals = [optional.pollIntervalMs ?? 1_000, optional.keepaliveIntervalMs ?? 25_000, optional.reauthorizeIntervalMs ?? 30_000];
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || intervals.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new RangeError("settings feed page size and intervals must be positive");
  }
  let closed = false;
  let ticking = false;
  let checkingAuthorization = false;
  const cancellations: Array<() => void> = [];
  const reportError = (operation: string, error: unknown): void => {
    // Reporting is best-effort: a host hook must never turn recovery into an unhandled rejection.
    try {
      if (optional.onError) optional.onError({ operation, error });
      else console.error(`[settings] change feed ${operation} failed`, error);
    } catch { /* Diagnostic failures cannot interrupt stream cleanup or retries. */ }
  };
  const recover = (operation: string, effect: () => void): void => {
    try { effect(); } catch (error) { reportError(operation, error); }
  };
  const release = (): void => {
    // Every resource gets its own recovery boundary so one failing cancellation cannot leak others.
    for (const cancel of cancellations.splice(0)) recover("cancel", cancel);
    recover("request-listener", () => { request.off("close", close); });
    recover("response-listener", () => { response.off("close", close); });
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    release();
    recover("close", () => { required.onClose({ close }); });
    if (!response.writableEnded && !response.destroyed) recover("end", () => { response.end(); });
  };
  request.on("close", close);
  response.on("close", close);
  try {
    const head = await changeFeed.head({});
    if (closed || required.isDisposed() || response.destroyed || response.writableEnded) { close(); return close; }
    const resumeFrom = Number(request.headers["last-event-id"]);
    let cursor = Number.isFinite(resumeFrom) && resumeFrom >= 0 ? Math.min(resumeFrom, head) : head;
    let lastEmittedId = cursor;
    const viewer = { workspaceId, principalId };
    response.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      ...(request.httpVersionMajor < 2 ? { Connection: "keep-alive" } : {}), "X-Accel-Buffering": "no",
    });
    const tick = async (): Promise<void> => {
      if (closed || ticking) return;
      ticking = true;
      try {
        // Snapshot head before the page: concurrent writes must never be skipped.
        const ledgerHead = await changeFeed.head({});
        if (closed) return;
        const batch = await changeFeed.collect({ sinceSeq: cursor, limit: pageSize, viewer });
        if (closed) return;
        const examined = batch.examinedCount < pageSize ? ledgerHead : batch.cursor;
        cursor = Math.max(cursor, examined, batch.cursor);
        if (!batch.namespaces.length) return;
        // The internal global head is never disclosed as an event id.
        lastEmittedId = Math.max(lastEmittedId, batch.cursor);
        response.write(`id: ${lastEmittedId}\nevent: settings-changed\ndata: ${JSON.stringify({ namespaces: batch.namespaces })}\n\n`);
      } catch (error) { if (!closed) reportError("poll", error); }
      finally { ticking = false; }
    };
    const reauthorize = async (): Promise<void> => {
      if (closed || checkingAuthorization) return;
      checkingAuthorization = true;
      try {
        const result = await required.authorize({ principalId, workspaceId, permission: required.permission, entityType: "setting-value" });
        if (!closed && !result.allowed) close();
      } catch (error) { if (!closed) reportError("re-authorization", error); }
      finally { checkingAuthorization = false; }
    };
    const schedule = (intervalMs: number, callback: () => void): void => {
      const cancel = scheduler.every({ intervalMs, callback });
      if (closed) recover("cancel", cancel); else cancellations.push(cancel);
    };
    schedule(intervals[0]!, () => { void tick(); });
    schedule(intervals[1]!, () => {
      if (closed) return;
      try { response.write(": keepalive\n\n"); }
      catch (error) { reportError("keepalive", error); close(); }
    });
    schedule(intervals[2]!, () => { void reauthorize(); });
    if (!closed) response.write(": connected\n\n");
    return close;
  } catch (error) {
    // Cancel schedules even when opening a feed fails. Let the HTTP wrapper map the error.
    if (response.headersSent) close();
    else { closed = true; release(); }
    throw error;
  }
}
