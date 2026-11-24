import { describe, expect, it, vi } from "vitest";

import { openMcpUiLink } from "../open-mcp-ui-link";

const ORIGIN = "https://admin.example.com";

/**
 * @file Coverage for `openMcpUiLink` (S-G1b, generic MCP-UI chat card link handling — memory
 * `links_open_new_tab`). `useMcpUiHost`'s `onOpenLink` is omitted by default (`McpUiHostOptions`'s
 * own doc: "Omit and the Host refuses the request"), so before this fix a View's `ui/open-link`
 * request was silently refused — every link inside a rendered MCP-UI card was inert. This is the
 * callback the host's dock now passes down through `OverflowAwareMcpUiSurfaceCard` ->
 * `McpUiSurfaceCard` -> `McpUiHost` -> `useMcpUiHost`.
 */
describe("openMcpUiLink", () => {
  it("opens an https URL in a new, unreferrered tab", () => {
    const openWindow = vi.fn();

    openMcpUiLink({ url: "https://example.com/docs", origin: ORIGIN, openWindow });

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith({ url: "https://example.com/docs", target: "_blank", features: "noopener,noreferrer" });
  });

  it("refuses a javascript: URL — a View cannot run script in this admin origin via a rendered link", () => {
    const openWindow = vi.fn();

    expect(() => openMcpUiLink({ url: "javascript:alert(document.cookie)", origin: ORIGIN, openWindow })).toThrow("This link is not a valid https:// address, so it was not opened.");

    expect(openWindow).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.com/docs",
    "data:text/html,<script>alert(1)</script>",
    "file:///tmp/private.txt",
    "blob:https://admin.example.com/1234",
  ])("refuses a non-https URL: %s", (url) => {
    const openWindow = vi.fn();
    expect(() => openMcpUiLink({ url, origin: ORIGIN, openWindow })).toThrow("This link is not a valid https:// address, so it was not opened.");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("reports an unparseable URL to the host", () => {
    const openWindow = vi.fn();

    expect(() => openMcpUiLink({ url: "not a url", origin: ORIGIN, openWindow })).toThrow("This link is not a valid https:// address, so it was not opened.");
    expect(openWindow).not.toHaveBeenCalled();
  });

  // Owner 2026-10-08: every chat link opens a new tab, in-app links included. A View's `<a href="/admin/…">`
  // reaches this handler unresolved (the sandbox proxy is an opaque `data:` document with no base to
  // resolve against), so a root-relative path means this admin's own page.
  it.each([
    "/api/admin/v1/workspaces/ws-1/mcp-servers/widget/oauth/sign-in",
    `/api/admin/v1/workspaces/ws-1/agent-plugins/connections/sign-in/${"a".repeat(43)}`,
  ])("opens the relative sign-in card path against the admin origin: %s", (url) => {
    const openWindow = vi.fn();

    openMcpUiLink({ url, origin: ORIGIN, openWindow });

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith({ url: `${ORIGIN}${url}`, target: "_blank", features: "noopener,noreferrer" });
  });

  it("refuses a protocol-relative URL — it names another host, not an in-app path", () => {
    const openWindow = vi.fn();

    expect(() => openMcpUiLink({ url: "//evil.example.com/x", origin: ORIGIN, openWindow })).toThrow("This link is not a valid https:// address, so it was not opened.");

    expect(openWindow).not.toHaveBeenCalled();
  });
});
