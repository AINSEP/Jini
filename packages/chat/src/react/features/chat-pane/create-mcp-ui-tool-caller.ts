/**
 * @module create-mcp-ui-tool-caller
 *
 * The client half of the MCP-UI two-step confirmation pattern: a ready-made
 * {@link McpUiToolCallHandler} that relays a View's `tools/call` to an HTTP endpoint.
 *
 * ```tsx
 * registerMcpUiSurfaceRenderer({ onToolCall: createMcpUiToolCaller('') });
 * ```
 *
 * That one line completes the loop. `@jini-ai/daemon`'s `delegated-tool-bridge.ts` splits a UI
 * resource out of a tool result and emits it as an `mcp-ui` run event; `McpUiSurfaceCard` renders it
 * in a sandboxed iframe; and when the human clicks, the View posts a `tools/call` that arrives here
 * and is forwarded to the host's own endpoint. Sibling of `create-daemon-attachment-uploader.ts`,
 * and deliberately the same shape: a host supplies a base URL, not a transport.
 *
 * ## Why this is a separate round trip rather than reusing the run's tool channel
 *
 * `McpUiToolCallHandler` receives only the call — no `runId`. That is not an oversight to work
 * around: the second step of a confirmation is genuinely **not** part of the agent's run. The run
 * that raised the dialog may have finished, the page may have been reloaded, and the human may click
 * minutes later. Binding redemption to a live run would make a confirmation expire for reasons that
 * have nothing to do with the decision being confirmed.
 *
 * So the endpoint this calls is a host-authenticated one (a browser session, typically), not the
 * daemon's run-scoped `/api/delegated-tool-calls`. **The human's own credentials are what authorize
 * the second step** — which is the entire point of the pattern. The agent never had them.
 *
 * ## What this deliberately does NOT do
 *
 * It performs no validation of `toolName` or `params` and holds no allow-list. A View's HTML is
 * untrusted — it came over a wire from a tool author — so any check here is a check the attacker
 * writes both sides of. The server endpoint is the security boundary: it re-authenticates, and the
 * single-use token minted into the dialog is what proves a human saw it. Adding a client-side
 * allow-list would suggest a protection that is not real.
 */
import type { McpUiToolCall, McpUiToolCallHandler } from '@jini-ai/ui/mcp-ui';

export interface CreateMcpUiToolCallerOptions {
  /**
   * Path appended to `baseUrl`. Defaults to `/api/mcp-ui/tool-calls`.
   *
   * Hosts mounting the redemption route inside an already-authenticated admin API will need this —
   * e.g. `/api/admin/v1/mcp-ui/tool-calls`.
   */
  readonly path?: string;
  /** Abandon a call after this many ms. Defaults to 30s — a human already clicked; this only bounds a hung server. */
  readonly timeoutMs?: number;
  /** Extra headers per request (e.g. a CSRF token). `content-type` is always set and cannot be overridden. */
  readonly headers?: Readonly<Record<string, string>>;
}

const DEFAULT_PATH = '/api/mcp-ui/tool-calls';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Body posted for one confirmed action. Kept flat so a server can validate it without a schema library. */
export interface McpUiToolCallRequest {
  readonly toolName: string;
  readonly params: Record<string, unknown>;
}

function errorTextFrom(body: unknown, status: number): string {
  if (typeof body === 'string' && body.length > 0) return body;
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    const message = record['error'] ?? record['message'];
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return `Request failed with status ${status}.`;
}

/**
 * Builds an {@link McpUiToolCallHandler} that POSTs `{toolName, params}` and returns the parsed
 * response.
 *
 * A non-2xx response throws with the server's own message where one is available. That matters:
 * `useMcpUiHost` relays a rejection to the View as a JSON-RPC error, so the dialog can print the
 * real reason ("this confirmation has expired") instead of hanging on "Working…". Swallowing the
 * error here would strand the human at a spinner with no way to tell a denial from a dead server.
 *
 * @param baseUrl - Origin to call. `''` for same-origin, which is the common case for an admin UI
 *   proxied to its own API.
 * @complexity O(1) — one request per call.
 */
export function createMcpUiToolCaller(
  baseUrl: string,
  options: CreateMcpUiToolCallerOptions = {},
): McpUiToolCallHandler {
  const path = options.path ?? DEFAULT_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = `${baseUrl.replace(/\/$/u, '')}${path}`;

  return async (call: McpUiToolCall): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // `{name, arguments}` on the MCP-UI side becomes `{toolName, params}` on the wire: `arguments`
      // is a reserved word in a JS function scope and reads badly in a server handler, and the
      // renamed pair matches what the reference implementation's redemption route already accepts.
      const request: McpUiToolCallRequest = {
        toolName: call.name,
        params: { ...call.arguments },
      };
      const response = await fetch(endpoint, {
        method: 'POST',
        // Same-origin cookie session is the usual authenticator for the human's second step.
        credentials: 'same-origin',
        headers: { ...options.headers, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const raw = await response.text();
      let parsed: unknown = raw;
      if (raw.length > 0) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Left as text — a proxy's HTML error page is more useful surfaced verbatim than swapped
          // for a generic "invalid JSON", which would hide what actually answered.
        }
      }

      if (!response.ok) throw new Error(errorTextFrom(parsed, response.status));
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for the server.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
