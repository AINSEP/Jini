/**
 * Response-side serialization: writes a plain JSON body or a standard `ApiError` envelope onto
 * an Express `Response` The status mapping (`statusForError`) lives in core. This is the terminal step of the Adapter's error-handling pipeline.
 */
import type { Response } from 'express';
import { createApiErrorResponse, type ApiError } from '@jini-ai/protocol';

/** The one response capability an API error write needs. Express's `Response` satisfies it structurally; a host on another server framework adapts its own response object to it. */
export interface ApiErrorResponseWriter { status(code: number): { json(body: unknown): unknown } }

/** Writes `body` as JSON with the given status code. */
export function sendJson({ res, status, body }: { readonly res: Response; readonly status: number; readonly body: unknown }, _optional: Record<string, never> = {}): void {
  res.status(status).json(body);
}

/** Writes an `ApiError`, wrapped in the standard `{ error }` envelope, with the given status code.
 * Older hand-mounted routes supplied code/message and metadata separately; construct their
 * ApiError first so both generations now share one serialization and envelope policy. */
export function sendApiError({ res, status, error }: { readonly res: ApiErrorResponseWriter; readonly status: number; readonly error: ApiError }, _optional: Record<string, never> = {}): void {
  res.status(status).json(createApiErrorResponse({ error: error }));
}
