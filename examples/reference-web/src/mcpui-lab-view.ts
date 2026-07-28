/**
 * The shared "which adversarial posture is the View in" contract for the MCP Apps demo.
 *
 * Consumed on BOTH sides of the fixture: `McpUiLab.tsx`/`McpUiLabHost.tsx` (the Host, which reads
 * this to build the mode selector and the iframe's `?mode=` query param) and
 * `mcpui-view-src/mcp-app.ts` (the View, which reads the same query param to decide its own
 * behavior). One shared module rather than two copies, so the two sides cannot silently drift
 * out of sync on what mode names exist.
 *
 * The View itself moved to `mcpui-view-src/mcp-app.ts` — built via
 * `vite build --config vite.mcpui-view.config.ts` using the real, officially-maintained
 * `@modelcontextprotocol/ext-apps` SDK, not hand-rolled here. See that file's module doc for why:
 * the Host must use Jini's own `mcp-ui-apps.ts` primitives (they're the thing under test), but
 * nothing requires the View to reinvent the wire protocol too, and a maintained SDK is a more
 * trustworthy counterparty to test Jini's Host against.
 *
 * The four modes, matching the fixture's adversarial test list:
 * - `normal` (default) — full, correct handshake, then a small interactive counter widget.
 * - `no-initialized` — completes `ui/initialize`, then deliberately never sends
 *   `ui/notifications/initialized`. Proves the Host times out instead of hanging forever.
 * - `call-before-init` — sends a `tools/call` request BEFORE ever sending `ui/initialize`.
 *   Proves the Host refuses it rather than servicing it.
 * - `never-respond-teardown` — completes the handshake normally, but when the Host later sends
 *   `ui/resource-teardown`, never answers. Proves the Host has a bounded wait rather than
 *   "SHOULD wait for a response" turning into "MUST wait forever" (a real hang bug if so).
 */

export const MCPUI_LAB_VIEW_MODES = ['normal', 'no-initialized', 'call-before-init', 'never-respond-teardown'] as const;
export type McpUiLabViewMode = (typeof MCPUI_LAB_VIEW_MODES)[number];

export function isMcpUiLabViewMode(value: string): value is McpUiLabViewMode {
  return (MCPUI_LAB_VIEW_MODES as readonly string[]).includes(value);
}
