
/**
 * Builds the MCP-UI sandbox proxy's iframe URL as a same-document `data:` URL, in place of a route
 * served from this admin app's own origin (`GET /mcp-ui/sandbox-proxy.html`, `apps/website`'s
 * `mcp-ui-sandbox-proxy-route.ts`). `@mcp-ui/client`'s `AppFrame` hardcodes `sandbox="allow-scripts
 * allow-same-origin allow-forms"` on the iframe it creates — not configurable away by this app or by
 * `@jini-ai/ui` — so a same-origin route means any third-party MCP server's HTML, once
 * `document.write`-n into that iframe by the proxy script, gets this admin origin's cookies, storage,
 * and same-origin fetches. A `data:` URL's origin is opaque under the URL Standard's own origin
 * algorithm regardless of `allow-same-origin` (verified live against a real Chromium build,
 * 2026-09-03 — see `@jini-ai/ui`'s `sandbox-proxy.ts` module doc), so switching to one closes that gap
 * without needing a second host, DNS entry, or CORS change: `buildSandboxProxyDataUrl` bakes this
 * admin app's own origin into the served script as a literal (never read back from the iframe's own
 * URL), so the ready/resource-ready handshake still only accepts messages from this window's real
 * parent.
 *
 * The old same-origin route stays mounted server-side (harmless, and it may still have other
 * consumers), but this admin dock no longer points an iframe at it.
 *
 * @param input.buildSandboxProxyDataUrl - The host UI library's `buildSandboxProxyDataUrl`; injected so this package imports no UI library.
 * @param input.hostOrigin - This admin app's own real origin — `globalThis.location.origin`, always, never
 *   a value parsed back out of this document's own URL.
 */
export function buildAssistantMcpUiSandboxProxyUrl({ hostOrigin, buildSandboxProxyDataUrl }: {
  hostOrigin: string;
  buildSandboxProxyDataUrl: (required: { hostOrigin: string }, optional?: Record<string, never>) => string;
}, _options: Record<string, never> = {}): URL {
  return new URL(buildSandboxProxyDataUrl({ hostOrigin }));
}
