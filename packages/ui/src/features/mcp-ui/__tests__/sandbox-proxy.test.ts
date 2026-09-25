/**
 * `SANDBOX_PROXY_HTML` is a page whose entire job is to `document.write` HTML it receives over
 * `postMessage` — i.e. to execute script on whatever origin a host serves it from. The guard on
 * that listener IS the trust boundary (see the module's own doc), and it is a string constant no
 * type checker or linter looks inside, so these tests pin the guard's exact source text. The first
 * version of this file shipped with no guard at all.
 */
import { describe, expect, it } from 'vitest';

import { buildIsolatedSandboxProxyHtml, buildSandboxProxyDataUrl, SANDBOX_PROXY_HTML } from '../sandbox-proxy.js';

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
