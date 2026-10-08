/**
 * @module features/mcp-ui/protocol
 *
 * The MCP Apps wire vocabulary, re-exported from `@jini-ai/agentic`'s `mcp-ui-apps.ts` rather than
 * restated here.
 *
 * `mcp-ui-apps.ts` owns message direction and isJsonRpcMessage's malformed-postMessage guards.
 * Duplicating those rules would
 * create a second surface to keep in sync with a moving spec, so this module owns nothing of the
 * envelope — it only re-exports it, plus adds the one constant that genuinely belongs to *this*
 * package: {@link MCP_UI_VIEW_SANDBOX}.
 *
 * ## What this package adds on top
 *
 * `mcp-ui-apps.ts` deliberately models the *envelope* and nothing else — it is transport-free and
 * touches no browser globals. It therefore has no notion of:
 * - the `ui://` **resource** a tool returns to get a View rendered at all (see `resource.ts`); that
 *   half comes from mcp-ui / MCP Apps' resource conventions, not from the JSON-RPC envelope.
 * - the **HTML** a View is made of (see `surfaces/`).
 * - a **Host implementation** (see `../../react/mcp-ui/`).
 *
 * Those are this package's three additions, and they are the only additions — everything about the
 * messages crossing the boundary comes from the re-exports below.
 */
export {
  JINI_PAGE_ACTION_METHOD,
  JSON_RPC_ERROR_CODES,
  MCP_UI_HOST_NOTIFICATIONS,
  MCP_UI_HOST_REQUESTS,
  MCP_UI_SANDBOX_NOTE,
  MCP_UI_VIEW_METHODS,
  MCP_UI_VIEW_NOTIFICATIONS,
  createJsonRpcError,
  createJsonRpcNotification,
  createJsonRpcRequest,
  createJsonRpcResult,
  createPageActionRequest,
  isJsonRpcMessage,
  isJsonRpcRequest,
} from '@jini-ai/agentic';

export type {
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from '@jini-ai/agentic';

/**
 * The `sandbox` attribute every View this package renders gets — `allow-scripts` and nothing else.
 *
 * Exported as a constant rather than written inline at the one `<iframe>` so it can be asserted by
 * a test and so the reason travels with it. `allow-same-origin` is **never** added, and this is not
 * a conservative default that a host may relax: a surface built by `surfaces/` is delivered via
 * `srcdoc`, which inherits the embedder's origin unless the sandbox withholds it. Adding
 * `allow-same-origin` to a `srcdoc` frame therefore hands the generated document full same-origin
 * access to the host page — its cookies, its storage, its DOM.
 *
 * The MCP Apps spec's own example does include `allow-same-origin`, and that is correct *there*,
 * for the reason `MCP_UI_SANDBOX_NOTE` spells out: spec Views are served from a separate origin
 * behind a sandbox proxy, so the flag grants access only to that isolated origin. `srcdoc` has no
 * separate origin to be isolated to. Copying the spec's line here would be the single worst bug
 * this package could ship, which is why it is a constant with this comment attached.
 *
 * Consequences the surface builders must live with, all of them deliberate:
 * - `localStorage` / `sessionStorage` throw `SecurityError` on first access in an opaque origin, so
 *   generated surfaces never touch storage.
 * - a View cannot know the host's origin, so it posts to `'*'`; the Host authenticates by
 *   `event.source` identity instead (see `../../react/mcp-ui/useMcpUiHost.ts`).
 */
export const MCP_UI_VIEW_SANDBOX = 'allow-scripts';

/**
 * The MCP Apps protocol version this package's Host advertises and its generated Views request.
 * The 2026-01-26 [Stable] release — not the draft, even though `mcp-ui-apps.ts` models draft
 * additions too, because advertising a version implies supporting all of it.
 */
export const MCP_UI_PROTOCOL_VERSION = '2026-01-26';
