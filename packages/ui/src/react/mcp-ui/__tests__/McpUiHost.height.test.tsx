/**
 * `McpUiHost`'s frame-height chrome once the View has reported a size. Reaching a real size report
 * needs the sandbox-proxy handshake jsdom cannot run (see `McpUiHost.test.tsx`'s header), so this
 * file wraps the REAL `useMcpUiHost` and overrides only the `size` it returns — every other field,
 * including the renderer props and ref, is the real hook's own.
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpUiHostResult } from '../useMcpUiHost.js';

const reportedSize = vi.hoisted(() => ({ current: null as McpUiHostResult['size'] }));

vi.mock('../useMcpUiHost.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useMcpUiHost.js')>();
  return {
    ...actual,
    useMcpUiHost: (options: Parameters<typeof actual.useMcpUiHost>[0]): McpUiHostResult => ({
      ...actual.useMcpUiHost(options),
      size: reportedSize.current,
    }),
  };
});

const { McpUiHost } = await import('../McpUiHost.js');

const SANDBOX_URL = new URL('https://sandbox.example.test/sandbox_proxy.html');

function frameHeight(props: { autoResize?: boolean; maxHeight?: number; initialHeight?: number } = {}): string {
  const { container } = render(<McpUiHost title="A view" html="<p>hi</p>" sandboxProxyUrl={SANDBOX_URL} {...props} />);
  return (container.querySelector('[data-mcpui-host]') as HTMLElement).style.height;
}

describe('McpUiHost frame height after a size report', () => {
  afterEach(() => {
    reportedSize.current = null;
  });

  it('follows the reported height', () => {
    reportedSize.current = { width: 300, height: 410 };
    expect(frameHeight()).toBe('410px');
  });

  it('clamps a reported height above the ceiling to maxHeight', () => {
    reportedSize.current = { width: 300, height: 5000 };
    expect(frameHeight({ maxHeight: 600 })).toBe('600px');
  });

  it('clamps an enormous reported height to the default 720px ceiling', () => {
    reportedSize.current = { width: 300, height: 5000 };
    expect(frameHeight()).toBe('720px');
  });

  it('never lets a reported height drop below 1px', () => {
    reportedSize.current = { width: 300, height: 0 };
    expect(frameHeight()).toBe('1px');
  });

  it('ignores the reported height when autoResize is off', () => {
    reportedSize.current = { width: 300, height: 410 };
    expect(frameHeight({ autoResize: false, initialHeight: 150 })).toBe('150px');
  });
});
