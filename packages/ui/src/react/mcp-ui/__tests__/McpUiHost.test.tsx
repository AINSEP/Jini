/**
 * `McpUiHost` after the `@mcp-ui/client` swap (see `useMcpUiHost.ts`'s module doc). Exercises the
 * REAL, unmocked `AppRenderer` from `@mcp-ui/client` — same rigor as the PoC that validated the
 * package before this swap: real DOM assertions, not "no exceptions".
 *
 * What jsdom genuinely cannot prove (a real sandbox-proxy page loading over the network and posting
 * back `ui/notifications/sandbox-proxy-ready`) is NOT faked here. Those tests assert on what
 * `AppRenderer` does synchronously and unconditionally on mount — real, unmocked behavior — same
 * boundary the PoC drew. The handshake-dependent behaviors (ready state, size-driven height, tool
 * calls) are covered in `useMcpUiHost.test.tsx` by invoking the REAL callback functions
 * `AppRenderer` would call, directly — see that file's own header for why that is still a genuine
 * exercise of this package's own adapter code, not a stub.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { McpUiHost } from '../McpUiHost.js';

const SANDBOX_URL = new URL('https://sandbox.example.test/sandbox_proxy.html');

describe('McpUiHost', () => {
  it('mounts AppRenderer, which creates a real sandboxed iframe pointed at the configured sandbox proxy URL', async () => {
    const { container } = render(<McpUiHost title="A view" html="<p>hi</p>" sandboxProxyUrl={SANDBOX_URL} />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const iframe = container.querySelector('iframe')!;
    expect(iframe.src).toBe(SANDBOX_URL.href);
    // AppRenderer's own hardcoded default (verified against the installed @mcp-ui/client bundle) —
    // this package no longer controls the sandbox attribute value directly, unlike the old srcdoc
    // implementation's MCP_UI_VIEW_SANDBOX constant.
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms');
    // Never a srcdoc document anymore — the View reaches the DOM only via the sandbox proxy relay.
    expect(iframe.hasAttribute('srcdoc')).toBe(false);
  });

  it('labels the wrapper with the given title and forwards className, and exposes the host state as a data attribute', () => {
    const { container } = render(
      <McpUiHost title="A view" html="<p>hi</p>" sandboxProxyUrl={SANDBOX_URL} className="chat-card" />,
    );
    const wrapper = container.querySelector('[data-mcpui-host]')!;
    expect(wrapper.getAttribute('aria-label')).toBe('A view');
    expect(wrapper.className).toBe('chat-card');
    // Nothing has driven a handshake yet in this synchronous assertion — real starting state.
    expect(wrapper.getAttribute('data-mcpui-state')).toBe('awaiting-ready');
  });

  it('starts at the default initial height before any size report', () => {
    const { container } = render(<McpUiHost title="A view" html="<p>hi</p>" sandboxProxyUrl={SANDBOX_URL} />);
    const wrapper = container.querySelector('[data-mcpui-host]') as HTMLElement;
    expect(wrapper.style.height).toBe('220px');
  });

  it('keeps the fixed initial height when autoResize is off, ignoring the initialHeight override', () => {
    const { container } = render(
      <McpUiHost title="A view" html="<p>hi</p>" sandboxProxyUrl={SANDBOX_URL} autoResize={false} initialHeight={140} />,
    );
    const wrapper = container.querySelector('[data-mcpui-host]') as HTMLElement;
    expect(wrapper.style.height).toBe('140px');
  });

  it('threads the html prop straight through to AppRenderer, keyed by sessionKey so a changed document forces a fresh session', async () => {
    const { container, rerender } = render(
      <McpUiHost title="A view" html="<p>one</p>" sandboxProxyUrl={SANDBOX_URL} sessionKey="a" />,
    );
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const firstIframe = container.querySelector('iframe')!;

    rerender(<McpUiHost title="A view" html="<p>two</p>" sandboxProxyUrl={SANDBOX_URL} sessionKey="b" />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBe(firstIframe));
  });

  it('keys off the html itself when no session key is given, so an identical re-render does not remount', async () => {
    const { container, rerender } = render(<McpUiHost title="A view" html="<p>one</p>" sandboxProxyUrl={SANDBOX_URL} />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const firstIframe = container.querySelector('iframe')!;

    rerender(<McpUiHost title="A view" html="<p>one</p>" sandboxProxyUrl={SANDBOX_URL} />);
    expect(container.querySelector('iframe')).toBe(firstIframe);

    rerender(<McpUiHost title="A view" html="<p>changed</p>" sandboxProxyUrl={SANDBOX_URL} />);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBe(firstIframe));
  });
});
