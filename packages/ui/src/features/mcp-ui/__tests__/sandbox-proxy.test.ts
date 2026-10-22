/**
 * `SANDBOX_PROXY_HTML` is a page whose entire job is to `document.write` HTML it receives over
 * `postMessage` — i.e. to execute script on whatever origin a host serves it from. The guard on
 * that listener IS the trust boundary (see the module's own doc), and it is a string constant no
 * type checker or linter looks inside, so these tests pin the guard's exact source text. The first
 * version of this file shipped with no guard at all.
 */
import { describe, expect, it } from 'vitest';

import { buildIsolatedSandboxProxyHtml, buildSandboxProxyDataUrl, SANDBOX_PROXY_HTML } from '../sandbox-proxy.js';
import { PROXY_LINK_FORWARDER_JS } from '../sandbox-proxy-link-forwarder.js';

describe('SANDBOX_PROXY_HTML', () => {
  it('accepts a resource message only from the embedding window, on the serving origin', () => {
    expect(SANDBOX_PROXY_HTML).toContain('return event.source === host && event.origin === hostOrigin;');
    expect(SANDBOX_PROXY_HTML).toContain('if (!isFromHost(event)) return;');
  });

  it('registers nothing at all when it is not framed, closing the window.open path', () => {
    expect(SANDBOX_PROXY_HTML).toContain('var host = window.parent;\n  var hostOrigin = window.location.origin;\n  if (host === window) return;');
  });

  it('addresses the ready notification to the serving origin instead of broadcasting it', () => {
    expect(SANDBOX_PROXY_HTML).toContain(
      'host.postMessage({ method: "ui/notifications/sandbox-proxy-ready", params: {} }, hostOrigin);',
    );
    expect(SANDBOX_PROXY_HTML).not.toContain('params: {} }, "*")');
  });

  it('still writes the guest HTML into this same document — the single-hop shape every surface bridge assumes', () => {
    expect(SANDBOX_PROXY_HTML).toContain('document.open();\n    document.write(html);\n    document.close();');
  });
});

/**
 * `@mcp-ui/client@7.1.1`'s `AppFrame` hardcodes `sandbox="allow-scripts allow-same-origin
 * allow-forms"` on the proxy iframe (verified against the installed dist, not assumed) — neither this
 * package nor a host application can refuse that flag. Combined with `SANDBOX_PROXY_HTML` served from
 * the same origin as an admin app (a host product's own wiring, `mcp-ui-sandbox-proxy-route.ts`), the guest HTML
 * this script `document.write`s in gets the admin origin's full authority: its cookies, its storage,
 * its same-origin fetches. `buildIsolatedSandboxProxyHtml`/`buildSandboxProxyDataUrl` are the fix —
 * see their own doc for the mechanism (a `data:` URL's origin is opaque regardless of
 * `allow-same-origin`, verified live against a real Chromium build). These tests would fail against
 * the pre-fix module, which exports neither function at all.
 */
describe('buildIsolatedSandboxProxyHtml / buildSandboxProxyDataUrl', () => {
  const hostOrigin = 'https://admin.example.com';

  it('bakes the caller-supplied hostOrigin in as a literal, never trusting window.location.origin', () => {
    const html = buildIsolatedSandboxProxyHtml(hostOrigin);
    expect(html).toContain(`var hostOrigin = ${JSON.stringify(hostOrigin)};`);
    expect(html).not.toContain('window.location.origin');
  });

  it('keeps the same source+origin guard shape as SANDBOX_PROXY_HTML, just against the baked-in origin', () => {
    const html = buildIsolatedSandboxProxyHtml(hostOrigin);
    expect(html).toContain('return event.source === host && event.origin === hostOrigin;');
    expect(html).toContain('document.open();\n    document.write(html);\n    document.close();');
  });

  it('JSON-escapes hostOrigin rather than interpolating it raw, so it cannot break out of the string literal', () => {
    const html = buildIsolatedSandboxProxyHtml('https://evil.example.com";alert(1);//');
    expect(html).toContain('var hostOrigin = "https://evil.example.com\\";alert(1);//";');
  });

  it('wraps the isolated HTML as a data: URL — an opaque, unique origin per the URL Standard, independent of any iframe sandbox attribute', () => {
    const url = buildSandboxProxyDataUrl(hostOrigin);
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);

    const encoded = url.slice('data:text/html;charset=utf-8,'.length);
    expect(decodeURIComponent(encoded)).toBe(buildIsolatedSandboxProxyHtml(hostOrigin));
  });
});

/**
 * A View is untrusted HTML in a sandbox without `allow-popups`/`allow-top-navigation`, so a plain
 * `<a href>` inside it either navigates the card's own frame away (same-tab) or is silently blocked
 * (`target="_blank"`). Owner 2026-10-08: every chat link opens a new tab. The proxy forwards link
 * clicks to the Host as `ui/open-link` — the one channel a sandboxed View has to open anything —
 * and these tests run the exact forwarder source the proxy page embeds.
 */
describe('proxy link forwarding', () => {
  type Posted = { message: { jsonrpc: string; id: string; method: string; params: { url: string } }; origin: string };

  function loadForwarder() {
    const posted: Posted[] = [];
    const host = { postMessage: (message: Posted['message'], origin: string) => posted.push({ message, origin }) };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the embedded page source verbatim.
    const forward = new Function('host', 'hostOrigin', `${PROXY_LINK_FORWARDER_JS}\nreturn forwardLinkClick;`)(
      host,
      'https://admin.example.com',
    ) as (event: MouseEvent) => void;
    return { posted, forward };
  }

  function clickOn(element: Element, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    Object.defineProperty(event, 'target', { value: element });
    return event;
  }

  function anchor(attrs: Record<string, string>, text = 'x'): HTMLAnchorElement {
    const a = document.createElement('a');
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    a.textContent = text;
    return a;
  }

  it('turns a link click into a ui/open-link request to the host origin and cancels the in-frame navigation', () => {
    const { posted, forward } = loadForwarder();
    const link = anchor({ href: 'https://example.com/docs' });
    const span = document.createElement('span');
    link.appendChild(span);
    const event = clickOn(span);
    forward(event);
    expect(event.defaultPrevented).toBe(true);
    expect(posted).toEqual([{
      origin: 'https://admin.example.com',
      message: { jsonrpc: '2.0', id: 'jini-proxy-open-link-1', method: 'ui/open-link', params: { url: 'https://example.com/docs' } },
    }]);
  });

  it('forwards a target=_blank link too — the sandbox would block its popup', () => {
    const { posted, forward } = loadForwarder();
    forward(clickOn(anchor({ href: 'https://example.com/a', target: '_blank' })));
    forward(clickOn(anchor({ href: 'https://example.com/b' })));
    expect(posted.map((p) => p.message.id)).toEqual(['jini-proxy-open-link-1', 'jini-proxy-open-link-2']);
  });

  it('leaves hash, empty, javascript:, download links, cancelled and non-primary clicks alone', () => {
    const { posted, forward } = loadForwarder();
    const cases = [
      clickOn(anchor({ href: '#top' })),
      clickOn(anchor({ href: '' })),
      clickOn(anchor({ href: ' javascript:void(0)' })),
      clickOn(anchor({ href: '/file.csv', download: '' })),
      clickOn(anchor({ href: 'https://example.com' }), { button: 1 }),
      clickOn(document.createElement('button')),
    ];
    const handled = clickOn(anchor({ href: 'https://example.com' }));
    handled.preventDefault();
    for (const event of [...cases, handled]) forward(event);
    expect(posted).toEqual([]);
  });

  it('is installed after the guest HTML is written, in both proxy variants', () => {
    const install = 'document.close();\n    window.addEventListener("click", forwardLinkClick);';
    expect(SANDBOX_PROXY_HTML).toContain(install);
    expect(SANDBOX_PROXY_HTML).toContain(PROXY_LINK_FORWARDER_JS);
    const isolated = buildIsolatedSandboxProxyHtml('https://admin.example.com');
    expect(isolated).toContain(install);
    expect(isolated).toContain(PROXY_LINK_FORWARDER_JS);
  });
});
