/**
 * @module features/mcp-ui
 *
 * The non-React half of MCP-UI support: the protocol vocabulary, the `ui://` resource shapes, the
 * confirmation-token store, and the surface builders that turn typed props into a self-contained
 * HTML document.
 *
 * **Nothing in this subtree imports React or emits JSX, and nothing should.** Everything here
 * ultimately produces a string that runs inside a sandboxed iframe with no bundler, no module
 * loader, and no React runtime — a JSX element would have nothing to render into. The React Host
 * that mounts these documents lives at `../../react/mcp-ui/` and depends on this direction only:
 * it calls into these builders, and they never call back.
 *
 * Published as `@jini-ai/ui/mcp-ui/surfaces` rather than only through the React entry point, because
 * the natural consumer of the builders is a **server** — an MCP tool handler returning a
 * confirmation dialog has no use for a React Host and should not have to resolve `react` to import
 * a string builder. (Tovu, a separate product outside this monorepo, is exactly that consumer: it
 * hand-rolled `createUIResource`/`escapeHtml`/`escapeJsString` and a delete-confirmation template
 * because it had nothing to import.)
 */
export * from './confirmation-store.js';
export * from './early-message-buffer.js';
export * from './escape.js';
export * from './protocol.js';
export * from './resource.js';
export * from './surfaces/index.js';
