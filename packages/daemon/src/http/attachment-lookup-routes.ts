/**
 * @module attachment-lookup-routes
 *
 * `POST /internal/attachment-lookup` — lets another local process (a site server running the
 * attachment tools) read this daemon's `AttachmentStore` without owning a second copy of it. The
 * store stays the sole owner of upload records; the caller gets exactly what the store's own two
 * read methods return, including the store's non-disclosing rejection for a ref another run owns.
 *
 * Body: `{ op: "resolveForRun", ref, runId }` or `{ op: "listPendingForOwner", ownerId, runId? }`.
 * Answer: `200 { value }` (`value: null` for an unknown ref), `400 ATTACHMENT_REJECTED` with
 * `details.reason` for a store rejection, `400 BAD_REQUEST` for a malformed body, and a redacted
 * `500` for anything else.
 *
 * Authentication is the host's: mount this behind the daemon's own bearer middleware. Run and owner
 * ids come from the authenticated caller's execution context, never from model input — the store
 * scopes by them (see `AttachmentStore.listPendingForOwner`).
 */
import { createApiError } from '@jini-ai/protocol';
import { jsonResponse, readJsonBody, statusForError } from '@jini-ai/core/contracts/server';
import { AttachmentRejectedError } from './attachment-types.js';
import type { AttachmentStore } from '@jini-ai/core/contracts/site/daemon-http';
import type { DaemonRouteHost } from './route-host.js';
import { gated, type DaemonRoute } from './route-table.js';

/** Where an unexpected failure's original error goes (the reporter's own sink argument). */
type RouteInternalErrorSink = NonNullable<Parameters<DaemonRouteHost['reportInternalError']>[1]>['onInternalError'];

export const ATTACHMENT_LOOKUP_ROUTE_PATH = '/internal/attachment-lookup';

/** The two read operations the lookup proxies. */
export type AttachmentLookupRequest =
  | { readonly op: 'resolveForRun'; readonly ref: string; readonly runId: string }
  | { readonly op: 'listPendingForOwner'; readonly ownerId: string; readonly runId?: string };

/** The read half of `AttachmentStore` a remote caller gets. */
export type AttachmentLookup = Pick<AttachmentStore, 'resolveForRun' | 'listPendingForOwner'>;

export interface AttachmentLookupRoutesRequired {
  readonly store: AttachmentLookup;
  readonly host: DaemonRouteHost;
}

/** The largest body this route reads (it has always had its own 64 KB limit). */
const LOOKUP_BODY_MAX_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseLookup(body: unknown): AttachmentLookupRequest | null {
  if (!isRecord(body)) return null;
  if (body.op === 'resolveForRun' && nonEmpty(body.ref) && nonEmpty(body.runId)) return { op: 'resolveForRun', ref: body.ref, runId: body.runId };
  if (body.op !== 'listPendingForOwner' || !nonEmpty(body.ownerId)) return null;
  if (body.runId !== undefined && !nonEmpty(body.runId)) return null;
  return { op: 'listPendingForOwner', ownerId: body.ownerId, ...(body.runId === undefined ? {} : { runId: body.runId }) };
}

async function runLookup(store: AttachmentLookup, lookup: AttachmentLookupRequest): Promise<unknown> {
  if (lookup.op === 'resolveForRun') return (await store.resolveForRun({ ref: lookup.ref, runId: lookup.runId })) ?? null;
  return store.listPendingForOwner({ ownerId: lookup.ownerId }, lookup.runId === undefined ? {} : { runId: lookup.runId });
}

const failure = ({ status, error }: { readonly status: number; readonly error: unknown }): Response => jsonResponse({ status, body: { error } });

function lookupFailure(
  { error, host }: { readonly error: unknown; readonly host: DaemonRouteHost },
  { onInternalError, runId }: { readonly onInternalError?: RouteInternalErrorSink | undefined; readonly runId?: string | undefined } = {},
): Response {
  if (error instanceof AttachmentRejectedError) {
    return failure({ status: 400, error: createApiError({ code: 'ATTACHMENT_REJECTED', message: error.message }, { details: { reason: error.reason } }) });
  }
  const report = { source: 'attachment-lookup', ...(runId === undefined ? {} : { runId }), error };
  return failure({ status: 500, error: host.reportInternalError({ report, logSource: 'attachment-lookup', message: 'The attachment could not be looked up. Try again; if it keeps failing, copy the request ID and report this problem.' }, { onInternalError }) });
}

/**
 * The lookup route as data. It reads its own JSON body (64 KB at most). `onInternalError` (optional) gets an
 * unexpected failure's original error, the run ID and the request ID the caller sees; without it the default
 * line prints the class only. The host's own bearer gate belongs in front of wherever this list is mounted.
 */
export function attachmentLookupRoutes({ store, host }: AttachmentLookupRoutesRequired, { onInternalError }: { readonly onInternalError?: RouteInternalErrorSink | undefined } = {}): DaemonRoute[] {
  return [gated({
    route: {
      method: 'POST', path: ATTACHMENT_LOOKUP_ROUTE_PATH,
      handler: async ({ request }) => {
        const body = await readJsonBody({ request }, { maxBytes: LOOKUP_BODY_MAX_BYTES });
        if (!body.ok) return failure({ status: statusForError({ error: body.error }), error: body.error });
        const lookup = parseLookup(body.value);
        if (lookup === null) {
          return failure({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'body must be { op: "resolveForRun", ref, runId } or { op: "listPendingForOwner", ownerId, runId? }' }) });
        }
        try {
          return jsonResponse({ status: 200, body: { value: await runLookup(store, lookup) } });
        } catch (error) {
          return lookupFailure({ error, host }, { onInternalError, runId: lookup.runId });
        }
      },
    },
    gates: [],
  })];
}
