/** @file Closed request and revision-token contract shared by HTTP and tool transports. */
import { ToolInputError } from "@jini-ai/core";


/** Reject unknown request fields and malformed version tokens before any mutation. O(fields). */
export function readConsentRequest({ body, fields }: { body: unknown; fields: readonly string[] }, _options = {}): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ToolInputError({ message: 'Request must be a JSON object.' });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !fields.includes(key))) throw new ToolInputError({ message: 'Unknown consent request field.' });
  return input;
}

/** Required nullable revision token; omission must never mean permission to overwrite. */
export function consentRevisionToken({ input, key }: { input: Record<string, unknown>; key: string }, _options = {}): string | null {
  const value = input[key];
  if (value === null || (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value))) return value;
  throw new ToolInputError({ message: `${key} must be a revision id or null.` });
}


/** Use the existing local-render path boundary before allocating a loopback server. O(path length).
 * @example consentPagePath({ path: '/privacy' }) */
export function consentPagePath({ path, resolvePath }: { path: string; resolvePath: (required: { raw: string }) => string }, _optional = {}): string {
  try { return resolvePath({ raw: path }); }
  catch { throw new ToolInputError({ message: 'Choose a local public page path without traversal, API paths, or an external URL.' }); }
}
