/**
 * @module features/mcp-ui/protocol
 *
 * The MCP Apps wire vocabulary lives in `@jini-ai/protocol/mcp-ui`; this module owns none of it.
 *
 * `@jini-ai/protocol/mcp-ui` owns message direction and isJsonRpcMessage's malformed-postMessage
 * guards. Duplicating those rules would create a second surface to keep in sync with a moving
 * spec, so this module owns nothing of the envelope — it adds only the constants that genuinely
 * belong to *this* package: {@link MCP_UI_VIEW_SANDBOX} and `MCP_UI_PROTOCOL_VERSION`.
 *
 * ## What this package adds on top
 *
 * `@jini-ai/protocol/mcp-ui` deliberately models the *envelope* and nothing else — it is transport-free and
 * touches no browser globals. It therefore has no notion of:
 * - the `ui://` **resource** a tool returns to get a View rendered at all (see `resource.ts`); that
 *   half comes from mcp-ui / MCP Apps' resource conventions, not from the JSON-RPC envelope.
 * - the **HTML** a View is made of (see `surfaces/`).
 * - a **Host implementation** (see `../../react/mcp-ui/`).
 *
 * Those are this package's three additions, and they are the only additions — everything about the
 * messages crossing the boundary comes from `@jini-ai/protocol/mcp-ui`.
 */
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
