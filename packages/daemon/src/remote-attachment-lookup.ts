/**
 * @module remote-attachment-lookup
 *
 * Client for `registerAttachmentLookupRoutes`: the two read methods of a daemon-owned
 * `AttachmentStore`, called from another local process over `node:http`. A store rejection comes
 * back as the same `AttachmentRejectedError` class (same `reason` and message), so a caller's
 * `instanceof` check behaves exactly as it would against the in-process store.
 *
 * Exported from `@jini-ai/daemon/http` rather than the root entry because it shares that class with
 * the attachments route pack.
 */
import * as http from 'node:http';
import { AttachmentRejectedError, type AttachmentRejectionReason } from './http/attachments.js';
import { ATTACHMENT_LOOKUP_ROUTE_PATH, type AttachmentLookup, type AttachmentLookupRequest } from './http/attachment-lookup-routes.js';

export interface RemoteAttachmentLookupRequired {
  /** Origin of the daemon, e.g. `http://127.0.0.1:4100`. */
  readonly baseUrl: string;
  /** The daemon's bearer token. */
  readonly token: string;
}

export interface RemoteAttachmentLookupOptional {
  /** Injectable `node:http.request`. */
  readonly request?: typeof http.request;
}

interface LookupResponse {
  readonly status: number;
  readonly body: unknown;
}

function postJson(
  { url, token, payload }: { readonly url: URL; readonly token: string; readonly payload: AttachmentLookupRequest },
  { request }: { readonly request: typeof http.request },
): Promise<LookupResponse> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      agent: false,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: null });
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

function errorOf(body: unknown): { code?: unknown; message?: unknown; details?: { reason?: unknown } } {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown; details?: { reason?: unknown } } : {};
}

/** Returns `value` from a 200, rethrows a store rejection as `AttachmentRejectedError`, else a plain error naming the status. */
function unwrap({ status, body }: LookupResponse): unknown {
  if (status === 200) return (body as { value?: unknown } | null)?.value ?? null;
  const error = errorOf(body);
  if (error.code === 'ATTACHMENT_REJECTED' && typeof error.details?.reason === 'string') {
    throw new AttachmentRejectedError({ reason: error.details.reason as AttachmentRejectionReason, message: String(error.message ?? '') });
  }
  const code = typeof error.code === 'string' ? ` ${error.code}` : '';
  throw new Error(`attachment lookup failed: HTTP ${status}${code}`);
}

/**
 * Creates the remote lookup.
 * @complexity One loopback round trip per call; O(response bytes).
 */
export function createRemoteAttachmentLookup(
  { baseUrl, token }: RemoteAttachmentLookupRequired,
  { request = http.request }: RemoteAttachmentLookupOptional = {},
): AttachmentLookup {
  const url = new URL(ATTACHMENT_LOOKUP_ROUTE_PATH, baseUrl);
  const call = async (payload: AttachmentLookupRequest): Promise<unknown> => unwrap(await postJson({ url, token, payload }, { request }));
  return {
    resolveForRun: async ({ ref, runId }) => ((await call({ op: 'resolveForRun', ref, runId })) ?? undefined) as Awaited<ReturnType<AttachmentLookup['resolveForRun']>>,
    listPendingForOwner: async ({ ownerId }, optional = {}) => (await call({
      op: 'listPendingForOwner',
      ownerId,
      ...(optional.runId === undefined ? {} : { runId: optional.runId }),
    })) as Awaited<ReturnType<AttachmentLookup['listPendingForOwner']>>,
  };
}
