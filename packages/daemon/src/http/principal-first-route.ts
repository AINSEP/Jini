/**
 * @file The standalone mount shared by the two surface endpoints (MCP-UI callback, A2UI action): one
 * `POST {path}` that refuses a request naming no principal BEFORE it reads the body, then reads the
 * JSON body and hands it to the endpoint's host-parsed entry point.
 *
 * The order is the security property. A host that mounts the entry point behind its own parser
 * (Express `json()` and the like) checks the principal before inspecting what that parser produced;
 * the standalone route must not be weaker than that by buffering and parsing an anonymous caller's
 * body — up to the host's body ceiling — only to answer 401 afterwards, or by answering an anonymous
 * malformed post with a 400/413 that tells the caller how its body was judged.
 */
import { jsonResponse, readJsonBody, statusForError } from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';
import { gated, type DaemonRoute } from './route-table.js';
import { readSurfacePrincipalId, surfaceReplyResponse, unauthenticatedReply } from './surface-callback-request.js';

/** A request whose body the host has already parsed, as the endpoints' entry points take it. */
export interface HostParsedRequest {
  readonly headers: { get(name: string): string | null };
  /** The parsed JSON body, or whatever the host's parser produced when the body was absent. */
  readonly body: unknown;
  readonly signal: AbortSignal;
}

/**
 * `POST {path}`: 401 when `principalHeader` is absent or empty (the body stream is left unread), then
 * the shared JSON body read under the host's ceiling, then `answer` with the parsed body.
 *
 * @complexity O(body size) for the read, plus `answer`'s own cost.
 */
export function principalFirstJsonPost(
  { path, host, principalHeader, answer }: {
    readonly path: string;
    readonly host: DaemonRouteHost;
    readonly principalHeader: string;
    readonly answer: (request: HostParsedRequest) => Response | Promise<Response>;
  },
  _optional: Record<string, never> = {},
): DaemonRoute {
  return gated({
    route: {
      method: 'POST',
      path,
      handler: async ({ request }) => {
        if (!readSurfacePrincipalId({ headers: request.headers, principalHeader })) return surfaceReplyResponse({ reply: unauthenticatedReply({ principalHeader }) });
        const body = await readJsonBody({ request }, { maxBytes: host.jsonBodyMaxBytes });
        if (!body.ok) return jsonResponse({ status: statusForError({ error: body.error }), body: { error: body.error } });
        return answer({ headers: request.headers, body: body.value, signal: request.signal });
      },
    },
    gates: [],
  });
}
