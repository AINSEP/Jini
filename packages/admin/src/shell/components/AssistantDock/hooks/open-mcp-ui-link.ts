/**
 * `useMcpUiHost`'s `onOpenLink` implementation for the host's dock (S-G1b, memory
 * `links_open_new_tab` — generic, not Supabase-specific: any bundled or third-party plugin's
 * rendered MCP-UI card gets the same "links open in a new tab" behavior). `McpUiHostOptions`'s own
 * doc is explicit that omitting this option makes the Host refuse every `ui/open-link` request, so
 * before this existed a link inside a rendered card did nothing at all — not a broken link, an
 * inert one.
 *
 * `https:` only, on purpose: a View is untrusted content (a third-party MCP server's own HTML,
 * `@mcp-ui/client`'s whole reason for existing), and `window.open` will happily hand a
 * `javascript:` URL a same-tab execution context, or hand a `file:`/`data:` URL more than a chat
 * card should ever be able to reach. Rejecting everything except `https:` is a strict allowlist,
 * not a denylist of the schemes seen so far. A URL that fails to parse at all (`new URL` throwing)
 * is treated the same as a wrong scheme — refused, not surfaced as an error to the View.
 *
 * One exception, a root-relative path (`/admin/…`, never protocol-relative `//host`): owner
 * 2026-10-08, every chat link opens a new tab, in-app links included. A View's `<a href>` reaches
 * here unresolved — Jini's sandbox proxy forwards link clicks as `ui/open-link`, and its opaque
 * `data:` document has no base to resolve a path against — so the path is resolved against the
 * host's own origin, the only page it can mean. That opens this app itself, whatever its scheme.
 *
 * `noopener,noreferrer` on the `openWindow` call itself closes `window.opener` back-reference
 * access (the tab-nabbing vector `rel="noopener"` exists for on a plain `<a>`) and withholds the
 * `Referer` header, matching how this app already opens every other off-site link — see memory
 * `links_open_new_tab`.
 *
 * @param input.origin - The host page's own origin, which a root-relative path resolves against (injected, never read from a global).
 * @param input.openWindow - Opens `url` in a browsing context (the host binds `window.open`).
 * @param input.url - The View's requested target, exactly as `useMcpUiHost` receives it from the
 *   `ui/open-link` request — not yet validated.
 * @complexity O(1) — one `URL` parse, at most one `openWindow` call.
 */
export function openMcpUiLink(
  { url, origin, openWindow }: { url: string; origin: string; openWindow: (input: { url: string; target: string; features: string }) => void },
  _optional: Record<string, never> = {},
): void {
  if (/^\/(?!\/)/.test(url)) {
    openWindow({ url: new URL(url, origin).href, target: "_blank", features: "noopener,noreferrer" });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("This link is not a valid https:// address, so it was not opened.");
  }
  if (parsed.protocol !== "https:") throw new Error("This link is not a valid https:// address, so it was not opened.");
  openWindow({ url, target: "_blank", features: "noopener,noreferrer" });
}

