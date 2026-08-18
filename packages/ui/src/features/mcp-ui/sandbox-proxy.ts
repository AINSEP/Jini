/**
 * @module features/mcp-ui/sandbox-proxy
 *
 * The one piece of NEW infrastructure the official `@mcp-ui/client` swap needs that this package's
 * hand-rolled Host never did: a **sandbox proxy** page.
 *
 * ## Why this exists
 *
 * `@mcp-ui/client`'s `AppRenderer`/`AppFrame` do not mount a View by writing HTML into an iframe's
 * `srcdoc` (the old `McpUiHost` did exactly that). Instead they point an iframe's `src` at a real,
 * separately-served URL — the "sandbox proxy" — wait for that page to report itself ready
 * (`ui/notifications/sandbox-proxy-ready`), and only THEN hand it the View's HTML via
 * `ui/notifications/sandbox-resource-ready`. A host that never serves such a page gets an iframe
 * that loads nothing and a `AppFrame`/`AppRenderer` that times out after 10s waiting for a ready
 * signal that will never come.
 *
 * This module exports the proxy's source as a **string constant** rather than a static file this
 * package's own build copies into `dist/`, for the same reason `surfaces/document.ts` builds HTML as
 * template strings: the natural way for a HOST APPLICATION (Tovu's admin server, `examples/reference-web`'s
 * dev server, any future consumer) to serve this is to mount ONE route that responds with this exact
 * body — `res.type('html').send(SANDBOX_PROXY_HTML)` — not to vendor a copy of a file from this
 * package's `dist/` into their own static-asset pipeline. A string a host can `fetch`/import needs no
 * new build-script wiring on either side.
 *
 * ## What actually needs to be served, and where — the part this package cannot do for you
 *
 * This module only produces the BYTES. Actually serving them — mounting a route, choosing a path,
 * deciding whether it needs a separate origin from the host app for defense-in-depth — is real
 * per-host infrastructure this package has no way to reach into a consumer's server and add itself.
 * See this constant's own doc for the concrete tradeoff. `examples/reference-web` mounts it (see
 * that example's own server/vite config) as the reference wiring for both local development in this
 * monorepo and for any external host copying the pattern.
 *
 * ## The relay contract this implements, verified against the real `@mcp-ui/client@7.1.1` bundle
 *
 * `AppFrame`'s internal mount effect (traced from the built package, since this exact mechanism is
 * not part of its public `.d.ts` surface):
 * 1. Creates an iframe, sets `sandbox="allow-scripts allow-same-origin allow-forms"`, and navigates
 *    it to the configured `sandbox.url`.
 * 2. Waits (10s timeout) for a `postMessage` from that iframe's `contentWindow` whose `data.method`
 *    is `"ui/notifications/sandbox-proxy-ready"`.
 * 3. Once ready, delivers the View's HTML via `postMessage({method: "ui/notifications/sandbox-resource-ready",
 *    params: {html}}, ...)`.
 *
 * This module's script does the minimum that satisfies that contract, matching the official
 * project's own reference implementation (`docs/src/guide/client/walkthrough.md`,
 * `MCP-UI-Org/mcp-ui` on GitHub, step 3 — verified 2026-08-18): post `sandbox-proxy-ready`
 * immediately, then on receiving `sandbox-resource-ready`, `document.open(); document.write(html);
 * document.close();`.
 *
 * ## Why `document.write`, not a second nested iframe, and what that means for `window.parent`
 *
 * The official docs' own architecture description elsewhere characterizes this as a "double-iframe"
 * design (an inner iframe hosting the untrusted app inside the outer sandbox-proxy iframe), and a
 * more hardened production deployment may well nest a second iframe for an additional isolation
 * hop. This module deliberately does NOT do that, and the choice is load-bearing for THIS package's
 * existing surface documents: every surface `surfaces/document.ts`/`surfaces/bridge.ts` generate
 * already contains its own inline protocol bridge script (`renderBridgeScript`) that talks to
 * `window.parent` directly — written years before this swap, on the assumption (true for the OLD
 * `srcdoc`-based Host) that its immediate parent IS the ultimate Host. `document.write`-ing that HTML
 * into THIS SAME window/document (rather than into a second, nested iframe) preserves that
 * assumption exactly: the guest script's `window.parent` is still the real Host, one hop away, same
 * as before. A nested-iframe proxy would put the guest TWO hops from the Host, breaking every
 * existing surface's bridge script silently (its `postMessage`s would land on the proxy, not the
 * Host, and nothing would ever answer `ui/initialize`). Choosing the single-hop shape is what makes
 * this swap possible WITHOUT touching `surfaces/bridge.ts`/`surfaces/document.ts`/any existing
 * surface builder — the wire protocol those already speak (JSON-RPC to `window.parent`) is exactly
 * what a single-hop proxy delivers unmodified.
 *
 * The real security tradeoff this simplification makes, spelled out rather than buried: the outer
 * (and, here, only) iframe carries `allow-same-origin` (`AppFrame`'s own hardcoded default — not
 * configurable away without also breaking the ready/resource-ready handshake, which this package's
 * script needs `window.parent` for regardless of same-origin status). Combined with `document.write`
 * happening in that SAME window, the guest surface gets full same-origin access to whatever origin
 * this proxy page is served from. This is the exact hazard `../protocol.ts`'s `MCP_UI_VIEW_SANDBOX`
 * comment warns about for a `srcdoc` frame — and it is why the official guidance is explicit that a
 * production sandbox proxy MUST be served from an origin distinct from the host application's own,
 * so "full same-origin access" only ever reaches an origin that holds nothing sensitive (no cookies,
 * no session, nothing but this one static page). **Serving this from the SAME origin as an admin
 * app, as a same-origin convenience route, reopens exactly the risk this package's `srcdoc` design
 * spent real effort avoiding.** See this session's report for why that tradeoff is left as an
 * explicitly flagged follow-up rather than silently accepted.
 */

/**
 * The sandbox proxy page's complete, self-contained source — see this module's own doc for the
 * protocol it implements and the security tradeoff serving it makes.
 *
 * A host mounts this at whatever URL it then passes as `sandbox={{ url }}` to `AppRenderer`/
 * `AppFrame` (this package's `McpUiHost`/`useMcpUiHost` included) — e.g. an Express route:
 * `app.get('/mcp-ui/sandbox-proxy.html', (_req, res) => res.type('html').send(SANDBOX_PROXY_HTML))`.
 */
export const SANDBOX_PROXY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MCP-UI sandbox proxy</title>
<style>html, body { margin: 0; padding: 0; width: 100%; height: 100%; }</style>
</head>
<body>
<script>
(function () {
  "use strict";
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.method === "ui/notifications/sandbox-resource-ready") {
      var html = data.params && data.params.html;
      if (typeof html === "string") {
        document.open();
        document.write(html);
        document.close();
      }
    }
  });
  window.parent.postMessage({ method: "ui/notifications/sandbox-proxy-ready", params: {} }, "*");
}());
</script>
</body>
</html>`;
