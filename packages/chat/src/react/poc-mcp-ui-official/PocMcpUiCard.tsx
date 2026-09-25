/**
 * @module poc-mcp-ui-official/PocMcpUiCard
 *
 * PROOF OF CONCEPT — see `create-poc-resource.ts`'s module doc for full context. Not wired into
 * this package's public API, not a replacement for `McpUiSurfaceCard.tsx`.
 *
 * Wraps `@mcp-ui/client`'s real `AppRenderer` component (the current name for what older versions
 * of `@mcp-ui/client` called `UIResourceRenderer` — renamed around its v6.0.0 rebrand onto the
 * `@modelcontextprotocol/ext-apps` "MCP Apps" spec). `AppRenderer` is given pre-fetched `html`
 * directly (skipping MCP resource-fetching, since this POC has no live MCP server behind it) and no
 * `client`, which is an explicitly supported mode per its own prop doc ("Omit to disable automatic
 * MCP forwarding and use custom handlers instead" — this POC supplies neither, since the one static
 * card it renders never calls a tool back).
 *
 * `AppRenderer` builds its own `AppBridge` internally and, on mount, creates a real sandboxed
 * `<iframe>` pointed at `sandbox.url`, then waits for that iframe to `postMessage` back a
 * `ui/notifications/sandbox-proxy-ready` notification before it will hand the HTML over. That
 * handshake needs a REAL sandbox-proxy page served at `sandbox.url` — this POC does not stand one
 * up (out of scope for validating the package's own API surface), so the test that renders this
 * component asserts on the real, unmocked iframe `AppRenderer` creates (src, sandbox attribute,
 * default sizing) rather than waiting for a live handshake that would just time out under jsdom.
 */
import { AppRenderer } from '@mcp-ui/client';

export interface PocMcpUiCardProps {
  /** Pre-fetched HTML — normally the `resource.text` from `createPocUiResource()`. */
  html: string;
  /** Where the (not-stood-up, for this POC) sandbox proxy page would live. */
  sandboxUrl: URL;
}

/** Renders one static MCP-UI card through the real `@mcp-ui/client` `AppRenderer`. */
export function PocMcpUiCard({ html, sandboxUrl }: PocMcpUiCardProps) {
  return (
    <AppRenderer
      toolName="poc-mcp-ui-official-card"
      sandbox={{ url: sandboxUrl }}
      html={html}
    />
  );
}
