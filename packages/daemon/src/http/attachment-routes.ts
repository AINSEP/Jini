/**
 * @file `POST` and `DELETE /api/attachments` as route lists. They are two lists because a host mounts them
 * differently: the upload streams the request's raw bytes to disk (mount it so no parser above has read the
 * body), while the cleanup reads a small JSON body (mount it behind the host's JSON parser, as any JSON route).
 * Hand-built rather than `jsonRoute` specs for the same two reasons: the raw stream, and the cleanup's `204`
 * with no body, which a JSON responder cannot express.
 */
import { sameOriginRefusal } from '@jini-ai/core/contracts/server';
import {
  ATTACHMENTS_ROUTE_PATH, handleAttachmentCleanup, handleAttachmentUpload, reportInternalError, respondToUploadFailure, failureAnswer,
  type AttachmentCall, type AttachmentsInternalErrorContext,
} from './attachments.js';
import type { DaemonRoute } from './route-table.js';

/**
 * Runs one attachment call under the host's activity lease, behind the same-origin guard.
 * The guard may throw (the origin policy can reject a malformed configured origin), so the whole call is
 * inside the `try`: nothing else stands between that throw and an unhandled rejection.
 */
async function admitted(
  { request, deps, host, source }: AttachmentCall & { readonly request: Request; readonly source: AttachmentsInternalErrorContext['source'] },
  run: () => Promise<Response>,
): Promise<Response> {
  let release: (() => void) | undefined;
  try {
    release = deps.acquireActivity?.();
    if (deps.requireSameOrigin !== false) {
      const refused = sameOriginRefusal({ request, origin: host.context });
      if (refused) return refused;
    }
    return await run();
  } catch (error) {
    if (source === 'attachment-upload') return respondToUploadFailure({ deps, host, error, batchId: null, source });
    return failureAnswer({ status: 500, error: reportInternalError({ deps, host, source, error, batchId: null }) });
  } finally {
    release?.();
  }
}

const originGate = (deps: AttachmentCall['deps']): DaemonRoute['gates'] => (deps.requireSameOrigin === false ? [] : ['same-origin']);

/**
 * The upload route. The count of uploads in flight is per call, not module-level: two daemons in one
 * process (a test harness, an embedded second host) must not share one upload budget.
 */
export function attachmentUploadRoutes({ deps, host }: AttachmentCall, _optional: Record<string, never> = {}): DaemonRoute[] {
  const state = { activeUploads: 0 };
  const route = {
    method: 'POST' as const, path: ATTACHMENTS_ROUTE_PATH,
    handler: ({ request, locals }: { readonly request: Request; readonly locals?: Record<string, unknown> }) =>
      admitted({ request, deps, host, source: 'attachment-upload' }, () => handleAttachmentUpload({ request, locals: locals ?? {}, deps, host, state })),
  };
  return [{ ...route, gates: originGate(deps) }];
}

/** The cleanup route: abandons a batch's unclaimed uploads. Answers 204 with no body. */
export function attachmentCleanupRoutes({ deps, host }: AttachmentCall, _optional: Record<string, never> = {}): DaemonRoute[] {
  const route = {
    method: 'DELETE' as const, path: ATTACHMENTS_ROUTE_PATH,
    handler: ({ request }: { readonly request: Request }) =>
      admitted({ request, deps, host, source: 'attachment-cleanup' }, () => handleAttachmentCleanup({ request, deps, host })),
  };
  return [{ ...route, gates: originGate(deps) }];
}
