/**
 * @module features/mcp-ui/sandbox-proxy-link-forwarder
 *
 * Page-script source the sandbox proxy (`sandbox-proxy.ts`) embeds so a View's plain `<a href>`
 * opens in a new tab. Inside the proxy's frame a link is useless on its own: `AppFrame`'s hardcoded
 * sandbox has neither `allow-popups` nor `allow-top-navigation`, so a same-tab link navigates the
 * card's own frame away from the View and a `target="_blank"` link is silently blocked. The one
 * channel a View has to open anything is the `ui/open-link` request, answered by the Host's
 * `onOpenLink` — so every qualifying link click becomes that request instead.
 *
 * Window, bubble phase, and skipped once `defaultPrevented`: it runs after every listener the View
 * itself registered, so a View that already handles its own link (calling `openLink` itself and
 * cancelling the click) is not opened twice.
 *
 * The request id is a string the View's own JSON-RPC ids (numbers) never use, so the Host's reply
 * cannot resolve one of the View's pending requests. `link.href` is the resolved URL when the
 * proxy has a real base; under the opaque `data:` proxy a relative href stays as written and the
 * Host decides how to resolve it.
 *
 * Not re-exported from the package (`index.ts` re-exports `sandbox-proxy.ts` only); the tests
 * evaluate this exact source.
 *
 * Expects `host` (the embedding window) and `hostOrigin` in scope — the proxy script's own vars.
 */
export const PROXY_LINK_FORWARDER_JS = `var openLinkSeq = 0;
  function forwardLinkClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var target = event.target;
    var link = target && target.closest ? target.closest("a[href]") : null;
    if (!link || link.hasAttribute("download")) return;
    var href = link.getAttribute("href");
    if (!href || href.charAt(0) === "#" || /^\\s*javascript:/i.test(href)) return;
    event.preventDefault();
    openLinkSeq += 1;
    host.postMessage(
      { jsonrpc: "2.0", id: "jini-proxy-open-link-" + openLinkSeq, method: "ui/open-link", params: { url: link.href } },
      hostOrigin
    );
  }`;
