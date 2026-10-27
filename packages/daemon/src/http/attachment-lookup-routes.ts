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
import express, { type Request, type RequestHandler, type Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { sendApiError, sendJson } from '@jini-ai/http-kit';
import { AttachmentRejectedError, type AttachmentStore } from './attachments.js';

export const ATTACHMENT_LOOKUP_ROUTE_PATH = '/internal/attachment-lookup';

/** The two read operations the lookup proxies. */
export type AttachmentLookupRequest =
  | { readonly op: 'resolveForRun'; readonly ref: string; readonly runId: string }
  | { readonly op: 'listPendingForOwner'; readonly ownerId: string; readonly runId?: string };

/** The read half of `AttachmentStore` a remote caller gets. */
export type AttachmentLookup = Pick<AttachmentStore, 'resolveForRun' | 'listPendingForOwner'>;

export interface AttachmentLookupRoutesRequired {
  readonly app: { post(path: string, ...handlers: RequestHandler[]): unknown };
  readonly store: AttachmentLookup;
}

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

function sendLookupFailure(res: Response, error: unknown): void {
  if (error instanceof AttachmentRejectedError) {
    sendApiError({ res, status: 400, error: createApiError({ code: 'ATTACHMENT_REJECTED', message: error.message }, { details: { reason: error.reason } }) });
    return;
  }
  sendApiError({ res, status: 500, error: createApiError({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' }) });
}

/**
 * Mounts the lookup route. It brings a small JSON parser of its own, which is a no-op when the host
 * already parsed the body upstream.
 */
export function registerAttachmentLookupRoutes({ app, store }: AttachmentLookupRoutesRequired, _optional: Record<string, never> = {}): void {
  app.post(ATTACHMENT_LOOKUP_ROUTE_PATH, express.json({ limit: '64kb' }), async (req: Request, res: Response) => {
    const lookup = parseLookup(req.body);
    if (lookup === null) {
      sendApiError({ res, status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'body must be { op: "resolveForRun", ref, runId } or { op: "listPendingForOwner", ownerId, runId? }' }) });
      return;
    }
    try {
      sendJson({ res, status: 200, body: { value: await runLookup(store, lookup) } });
    } catch (error) {
      sendLookupFailure(res, error);
    }
  });
}
