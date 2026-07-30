/**
 * @module react/mcp-ui
 *
 * The React Host for MCP-UI: the component that mounts a sandboxed View in the chat pane, runs the
 * `ui/initialize` handshake, and forwards the View's `tools/call` requests to a host-supplied
 * executor.
 *
 * This half owns React and the DOM; it never hand-builds HTML. The documents it mounts come from
 * `@jini-ai/ui/mcp-ui/surfaces` (`../../features/mcp-ui/`), which owns no React. The dependency runs
 * one way only.
 */
export * from './McpUiHost.js';
export * from './McpUiSurfaceCard.js';
export * from './host-message-source.js';
export * from './useMcpUiHost.js';

// Re-exported so a React consumer needs one import for the whole feature: the Host takes an HTML
// string, and the builders are what produce one. `@jini-ai/ui/mcp-ui/surfaces` remains the entry
// point for a server with no React in it at all.
export * from '../../features/mcp-ui/index.js';
