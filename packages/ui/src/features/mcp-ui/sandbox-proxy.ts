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
 * template strings: the natural way for a HOST APPLICATION (a downstream product's admin server, `examples/reference-web`'s
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
 *
 * ## Who is allowed to hand this page HTML — the origin check, and why it is shaped this way
 *
 * `document.write`-ing a `postMessage` payload is script execution on this page's origin, so the
 * listener's guard IS the trust boundary. The first version of this file had none: it read
 * `event.data` without ever looking at `event.origin` or `event.source`, which meant ANY page that
 * could get a handle on this window — by framing it, or by `window.open`-ing it and keeping the
 * returned reference — could post `sandbox-resource-ready` and run its own script on the serving
 * origin. Two checks close that, and both are needed:
 *
 * - `event.source === window.parent` binds delivery to the window that actually embedded this page.
 *   `event.source` is set by the browser and cannot be forged by the sender, and it is the only
 *   check that covers the `window.open` case at all: an opener is `window.opener`, never
 *   `window.parent`. The `window.parent === window` early return makes that airtight — a top-level
 *   (unframed) copy of this page registers no listener and does nothing, which is correct, because
 *   an unframed sandbox proxy has no host to serve and no handshake to complete.
 * - `event.origin === window.location.origin` is the second, independent check, and it is what
 *   makes a hostile FRAMER fail too (that attacker does satisfy `event.source === window.parent`).
 *   A host serving this page cross-origin from itself — the hardening the section above recommends
 *   — will need to widen this to an allowlist. That allowlist must be baked into the served bytes
 *   by the host's own server, NOT read from this page's query string or fragment: an attacker who
 *   can frame the page also picks the `src`, so a URL-supplied expected origin is attacker-supplied
 *   and defeats the check entirely. That is deliberately left unbuilt rather than built wrong.
 *
 * For the same reason the ready notification is addressed to `window.location.origin` rather than
 * broadcast with `"*"`: a hostile framer should not even learn that the page loaded. Neither check
 * hardcodes any particular host — a consumer's origin is discovered at runtime from the page's own
 * URL — and neither touches the single-hop `document.write` shape the section above depends on.
 */

/**
 * The sandbox proxy page's complete, self-contained source — see this module's own doc for the
 * protocol it implements and the security tradeoff serving it makes.
 *
 * A host mounts this at whatever URL it then passes as `sandbox={{ url }}` to `AppRenderer`/
 * `AppFrame` (this package's `McpUiHost`/`useMcpUiHost` included) — e.g. an Express route:
 * `app.get('/mcp-ui/sandbox-proxy.html', (_req, res) => res.type('html').send(SANDBOX_PROXY_HTML))`.
 *
 * That route SHOULD also send `Content-Security-Policy: frame-ancestors 'self'` (plus
 * `X-Frame-Options: SAMEORIGIN` for browsers predating it). The page's own origin check already
 * refuses to `document.write` anything a hostile framer sends it, but the header is what stops the
 * page being framed by a third party in the first place — and it is the layer that still holds if a
 * future edit to the script below regresses. `frame-ancestors 'none'`/`X-Frame-Options: DENY` is
 * NOT the value to reach for: this page exists to be framed by its host, so `DENY` breaks every
 * surface. Do not add `default-src`/`script-src` directives to that header either: a header CSP
 * survives `document.open()` and would then apply to the guest HTML written in below, silently
 * breaking any UIResource whose HTML this package did not build. Surfaces built by
 * `surfaces/document.ts` already carry their own `SURFACE_CSP` meta tag for exactly that job.
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
  var host = window.parent;
  var hostOrigin = window.location.origin;
  if (host === window) return;

  function isFromHost(event) {
    return event.source === host && event.origin === hostOrigin;
  }

  window.addEventListener("message", function (event) {
    if (!isFromHost(event)) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.method !== "ui/notifications/sandbox-resource-ready") return;
    var html = data.params && data.params.html;
    if (typeof html !== "string") return;
    document.open();
    document.write(html);
    document.close();
  });

  host.postMessage({ method: "ui/notifications/sandbox-proxy-ready", params: {} }, hostOrigin);
}());
</script>
</body>
</html>`;

/**
 * Same script as {@link SANDBOX_PROXY_HTML}, with one load-bearing difference: `hostOrigin` is the
 * caller-supplied `hostOrigin` argument, baked in as a literal, instead of read from
 * `window.location.origin`. Paired with {@link buildSandboxProxyDataUrl}, this is what actually
 * closes the "admin-origin authority" gap this module's own doc flags above — not by dropping
 * `allow-same-origin` (verified against the installed `@mcp-ui/client@7.1.1` bundle: `AppFrame`
 * hardcodes `sandbox="allow-scripts allow-same-origin allow-forms"` on the iframe it creates, with no
 * prop to override it — neither this package nor a host application can refuse that flag), but by
 * changing what "same-origin" MEANS: a `data:` URL gets a fresh, unique, OPAQUE origin under the URL
 * Standard's own origin algorithm, a rule that holds regardless of the iframe's `sandbox` attribute
 * (verified live against a real Chromium build, 2026-09-03: an iframe with the exact hardcoded flags
 * above, navigated to a `data:` URL, still reports `window.location.origin === "null"` inside). Once
 * the proxy's own document has no real origin to share with its embedder, the guest HTML this script
 * `document.write`s into it can never reach the embedder's cookies, storage, or same-origin fetches —
 * there is no real origin left for "same-origin" to mean.
 *
 * That is also why this can no longer read `window.location.origin` for the ready/resource-ready
 * handshake's own origin check: inside an opaque-origin document that call always returns the literal
 * string `"null"`, which would never equal the embedder's real origin and would permanently break the
 * handshake. `hostOrigin` has to come from somewhere else — the embedder's OWN trusted value, baked in
 * at construction time. It must never be read back from this document's own URL (query string,
 * fragment, or otherwise): whoever can choose this document's `src` can choose that value too, which
 * would defeat the check exactly as this module's existing doc warns for the cross-origin-hosting
 * case.
 *
 * @param hostOrigin - The embedder's own real origin, computed by the embedder itself (e.g. its own
 *   `window.location.origin`) — never a value parsed out of this proxy document's own URL.
 */
export function buildIsolatedSandboxProxyHtml(hostOrigin: string): string {
  const hostOriginLiteral = JSON.stringify(hostOrigin);
  // A `data:` document has no HTTP response of its own to carry a CSP header, so per CSP3's
  // "local scheme" inheritance rule this inline <script> runs under whatever CSP the embedder's
  // OWN document currently has (none, for the host product's admin app today — verified 2026-09-03: no
  // helmet/blanket CSP is applied to admin HTML responses). If a future hardening pass adds a
  // strict `script-src` CSP to the embedder, this inline script will need `'unsafe-inline'` (or a
  // nonce this template does not currently support) to keep running — check that before assuming
  // this proxy still renders under a new admin CSP.
  return `<!doctype html>
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
  var host = window.parent;
  var hostOrigin = ${hostOriginLiteral};
  if (host === window) return;

  function isFromHost(event) {
    return event.source === host && event.origin === hostOrigin;
  }

  window.addEventListener("message", function (event) {
    if (!isFromHost(event)) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.method !== "ui/notifications/sandbox-resource-ready") return;
    var html = data.params && data.params.html;
    if (typeof html !== "string") return;
    document.open();
    document.write(html);
    document.close();
  });

  host.postMessage({ method: "ui/notifications/sandbox-proxy-ready", params: {} }, hostOrigin);
}());
</script>
</body>
</html>`;
}

/**
 * Wraps {@link buildIsolatedSandboxProxyHtml} as a `data:` URL — the form a host passes directly as
 * `sandbox={{ url }}` to `@mcp-ui/client`'s `AppRenderer`/`AppFrame` (this package's
 * `McpUiHost`/`useMcpUiHost` included) in place of a same-origin HTTP route. No server route, second
 * host, or CORS/postMessage-origin change is needed to get the isolation official MCP-UI guidance
 * recommends — see {@link buildIsolatedSandboxProxyHtml}'s own doc for why a `data:` URL earns that
 * isolation on its own.
 *
 * @param hostOrigin - Forwarded verbatim to {@link buildIsolatedSandboxProxyHtml} — see that
 *   function's own doc for the contract.
 */
export function buildSandboxProxyDataUrl(hostOrigin: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildIsolatedSandboxProxyHtml(hostOrigin))}`;
}
