/**
 * @module @jini-ai/mcp/server/daemon-error-text
 * The words an MCP tool call shows when the daemon answers with a non-2xx status.
 *
 * Disclosure rule: only the fields of a recognized error envelope (nested `{ error: { code, message } }`
 * or flat `{ error: "text" }`) are shown, because the server wrote those for the caller. Any other
 * answer (HTML, plain text, invalid JSON, empty) was not written for the caller, so it is never quoted,
 * not even its first line. The caller gets fixed words, the status and an error ID instead. This
 * module never receives body text: it gets the parsed value for the envelope fields and a flag.
 */
import { decodeApiError } from '@jini-ai/protocol';

/** Cap on an envelope's `details` that the error carries: anything larger is dropped, not truncated. */
const MAX_DETAILS_BYTES = 4096;

export interface DaemonFailureText {
  readonly message: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
}

/** True when `data` is an envelope the server wrote for the caller: a message or a code under `error` or at the top level. */
export function isRecognizedEnvelope({ data }: { data: unknown }, _optional: Record<string, never> = {}): boolean {
  const decoded = decodeApiError({ body: data }, { fallbackMessage: '' });
  return decoded.message !== '' || decoded.code !== undefined;
}

/** A plain JSON object under {@link MAX_DETAILS_BYTES}, or undefined. */
function boundedDetails({ details }: { details: unknown }): Record<string, unknown> | undefined {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return undefined;
  if (Object.getPrototypeOf(details) !== Object.prototype) return undefined;
  const text = JSON.stringify(details);
  return text !== undefined && Buffer.byteLength(text, 'utf8') <= MAX_DETAILS_BYTES ? details as Record<string, unknown> : undefined;
}

function unreadableMessage({ status }: { status: number }, { errorId }: { errorId?: string | undefined }): string {
  const refused = status >= 400 && status < 500;
  const head = refused
    ? `The tool service refused this call (HTTP ${status}) and its answer was not readable.`
    : `The tool service failed (HTTP ${status}) and its answer was not readable.`;
  if (errorId === undefined) {
    return refused
      ? `${head} Check the arguments; if they are right, tell the user the tool service refused the call.`
      : `${head} Do not retry the same call; tell the user the tool service failed.`;
  }
  return refused
    ? `${head} Error ID: ${errorId}. Check the arguments; if they are right, give the user this error ID.`
    : `${head} Error ID: ${errorId}. Do not retry the same call; give the user this error ID.`;
}

function readableMessage({ status, message, code, requestId }: { status: number; message: string; code?: string | undefined; requestId?: string | undefined }): string {
  const idClause = requestId === undefined ? '' : ` Error ID: ${requestId}.`;
  if (code === undefined && status === 503) {
    return `The tool service is restarting or closed (HTTP 503): ${message.replace(/\.$/, '')}. Wait a few seconds and retry once.${idClause}`;
  }
  const detail = [code, message === '' ? undefined : message].filter(part => part !== undefined).join(': ');
  return `HTTP ${status}: ${detail}${idClause}`;
}

/**
 * Builds the message of a non-2xx daemon answer.
 * @param required.status - The HTTP status.
 * @param required.data - The parsed body (untrusted; only envelope fields are read).
 * @param required.readable - {@link isRecognizedEnvelope} of `data`.
 * @param optional.errorId - The ID the host's reporter recorded for an unreadable answer.
 * @returns The message (still to pass through the diagnostic sanitizer when `readable`) and the envelope's code, request ID and bounded details.
 * @complexity O(size of `details`) for the byte bound; otherwise O(1).
 */
export function describeDaemonFailure(
  required: { status: number; data: unknown; readable: boolean },
  optional: { errorId?: string } = {},
): DaemonFailureText {
  const { status, data, readable } = required;
  if (!readable) return { message: unreadableMessage({ status }, { errorId: optional.errorId }) };
  const decoded = decodeApiError({ body: data }, { fallbackMessage: '' });
  const details = boundedDetails({ details: decoded.details });
  return {
    message: readableMessage({ status, message: decoded.message, code: decoded.code, requestId: decoded.requestId }),
    ...(decoded.code === undefined ? {} : { code: decoded.code }),
    ...(decoded.requestId === undefined ? {} : { requestId: decoded.requestId }),
    ...(details === undefined ? {} : { details }),
  };
}
