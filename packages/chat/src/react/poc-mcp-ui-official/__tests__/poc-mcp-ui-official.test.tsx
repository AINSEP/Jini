/**
 * PROOF OF CONCEPT — real end-to-end exercise of the official `@mcp-ui/server` +
 * `@mcp-ui/client` packages (installed for real in this package's `package.json` /
 * the repo `pnpm-lock.yaml`, not stubbed), per the owner's decision to stop hand-rolling MCP-UI
 * client rendering. This is additive validation, not a replacement — `McpUiSurfaceCard.tsx`,
 * `useMcpUiHost`, and `create-mcp-ui-tool-caller.ts` are untouched and still the live code path.
 *
 * Two things this test exists to catch, both real risks going in:
 *
 * 1. The previously-reproduced CJS/ESM interop bug on `@mcp-ui/client` (named exports coming back
 *    undefined against v7.1.1). Importing `AppRenderer` at the top of this file via a plain ESM
 *    `import` — the same path Vitest's SSR module resolution uses for this "type": "module"
 *    package — and asserting it is a real, callable/renderable export IS the regression check for
 *    that bug at THIS version. (Confirmed separately, outside this test file, that the bug is
 *    real but narrower than originally reported: only `require('@mcp-ui/client')` — the CJS
 *    build — is broken in 7.1.1; plain ESM `import` works. See this session's final report.)
 * 2. `@mcp-ui/client`'s React API was renamed (`UIResourceRenderer` → `AppRenderer`) and
 *    restructured (it now requires a `sandbox.url` pointing at a live "sandbox proxy" page and
 *    performs a real postMessage handshake before it will render a guest's HTML) somewhere between
 *    whatever version was last evaluated and today's latest (7.1.1). A stale import name or a
 *    prop shape from the old API would fail to even compile/render here.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppRenderer } from '@mcp-ui/client';
import { createPocUiResource, POC_CARD_HTML, POC_CARD_URI } from '../create-poc-resource.js';
import { PocMcpUiCard } from '../PocMcpUiCard.js';

describe('@mcp-ui/server createUIResource (real package, POC)', () => {
  it('builds a real UIResource with the correct shape and content — not an empty/undefined export', () => {
    const resource = createPocUiResource();

    // The CJS/ESM interop bug this POC was dispatched to re-check manifests as named exports
    // coming back `undefined`. If `createUIResource` had regressed to that, this call would have
    // thrown ("createUIResource is not a function") before this line — so getting a real object
    // back is itself part of the regression check, not just a shape assertion.
    expect(resource.type).toBe('resource');
    expect(resource.resource.uri).toBe(POC_CARD_URI);
    expect(resource.resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.resource.text).toBe(POC_CARD_HTML);
    expect(resource.resource.text).toContain('Hello from @mcp-ui/server');
  });
});

describe('@mcp-ui/client AppRenderer (real package, POC)', () => {
  it('is a real, callable export — the CJS/ESM interop bug would have made this undefined', () => {
    expect(typeof AppRenderer).toBe('object'); // forwardRef component: typeof is 'object', not 'function'
    expect(AppRenderer).not.toBeUndefined();
  });

  it('renders the server-created resource as a real sandboxed card (iframe), end to end', async () => {
    const resource = createPocUiResource();
    const sandboxUrl = new URL('https://sandbox.example.test/sandbox_proxy.html');

    const { container } = render(<PocMcpUiCard html={resource.resource.text as string} sandboxUrl={sandboxUrl} />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());

    // AppRenderer's real (unmocked) mount behavior: it creates exactly one sandboxed iframe
    // pointed at the sandbox proxy URL we gave it. It does NOT inline the HTML via `srcdoc` (that
    // was the OLD hand-rolled/legacy API's model) — the real handshake delivers HTML to the guest
    // via postMessage only after the sandbox proxy reports itself ready, which this POC does not
    // stand up a live page for (out of scope: this validates the package's own API surface, not a
    // hosted sandbox deployment). So the real, honest assertion here is on what AppRenderer does
    // synchronously and unconditionally on mount, not on the full live-content handshake.
    const frames = container.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);

    const frame = frames[0] as HTMLIFrameElement;
    expect(frame.src).toBe(sandboxUrl.href);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms');
    // jsdom's cssstyle module silently drops a bare `border: none` shorthand (it can't resolve it
    // to width/style/color sub-properties), so the raw style attribute AppRenderer actually wrote
    // is `width: 100%; height: 600px; background-color: transparent;` — no `border` fragment
    // survives the round trip. Asserting on the three properties jsdom DOES preserve is still a
    // real, specific check of AppRenderer's real default styling (matching its own source: width
    // 100%, height 600px, transparent background), not a weakened one.
    expect(frame.getAttribute('style')).toBe('width: 100%; height: 600px; background-color: transparent;');
  });

  it('does not silently no-op the whole component when html is provided directly', async () => {
    // If AppRenderer/AppFrame's internal "fetch the resource" path were the only way it ever
    // produced an iframe, a POC feeding pre-fetched `html` (per the package's own documented
    // `html?: string` prop — "skips all resource fetching") would render nothing and this
    // component's real integration into the chat pane would be broken on day one.
    const { container } = render(
      <PocMcpUiCard html="<p>irrelevant for this assertion</p>" sandboxUrl={new URL('https://sandbox.example.test/proxy.html')} />,
    );
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  });
});
