import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { McpUiHost } from '../McpUiHost.js';
import { MCP_UI_VIEW_SANDBOX } from '../../../features/mcp-ui/protocol.js';
import type { BufferedWindowMessage } from '../../../features/mcp-ui/early-message-buffer.js';

function createTestSource() {
  const handlers = new Set<(message: BufferedWindowMessage) => void>();
  return {
    source: (handler: (message: BufferedWindowMessage) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    deliver(data: unknown, source: unknown) {
      act(() => {
        for (const handler of [...handlers]) handler({ data, origin: 'null', source });
      });
    },
  };
}

function frame(): HTMLIFrameElement {
  return screen.getByTitle('A view') as HTMLIFrameElement;
}

/** Drives a mounted host to `ready` and reports the given content size. */
function reportSize(bus: ReturnType<typeof createTestSource>, height: number) {
  const view = frame().contentWindow!;
  bus.deliver({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} }, view);
  bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, view);
  bus.deliver({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height } }, view);
}

describe('McpUiHost', () => {
  it('never grants allow-same-origin — the one flag that would hand the surface the host’s origin', () => {
    render(<McpUiHost title="A view" html="<p>hi</p>" />);
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts');
    expect(MCP_UI_VIEW_SANDBOX).not.toContain('allow-same-origin');
  });

  it('mounts the document via srcdoc, not a URL', () => {
    render(<McpUiHost title="A view" html="<p>hello</p>" />);
    expect(frame().getAttribute('srcdoc')).toBe('<p>hello</p>');
    expect(frame().hasAttribute('src')).toBe(false);
  });

  it('exposes the session state and an optional class name on the wrapper', () => {
    const { container } = render(<McpUiHost title="A view" html="<p>hi</p>" className="chat-card" />);
    const wrapper = container.querySelector('[data-mcpui-host]')!;
    expect(wrapper.getAttribute('data-mcpui-state')).toBe('awaiting-initialize');
    expect(wrapper.className).toBe('chat-card');
  });

  it('starts at the default height and follows the View’s reported size', () => {
    const bus = createTestSource();
    render(<McpUiHost title="A view" html="<p>hi</p>" messageSource={bus.source} />);
    expect(frame().style.height).toBe('220px');
    reportSize(bus, 410);
    expect(frame().style.height).toBe('410px');
  });

  it('clamps a runaway reported height so a View cannot push the page off-screen', () => {
    const bus = createTestSource();
    render(<McpUiHost title="A view" html="<p>hi</p>" messageSource={bus.source} maxHeight={300} />);
    reportSize(bus, 99_999);
    expect(frame().style.height).toBe('300px');
  });

  it('floors a zero-height report at one pixel rather than collapsing the frame', () => {
    const bus = createTestSource();
    render(<McpUiHost title="A view" html="<p>hi</p>" messageSource={bus.source} />);
    reportSize(bus, 0);
    expect(frame().style.height).toBe('1px');
  });

  it('keeps the fixed height when autoResize is off', () => {
    const bus = createTestSource();
    render(<McpUiHost title="A view" html="<p>hi</p>" messageSource={bus.source} autoResize={false} initialHeight={140} />);
    expect(frame().style.height).toBe('140px');
    reportSize(bus, 900);
    expect(frame().style.height).toBe('140px');
  });

  it('remounts the frame when the session key changes, so the new document gets a fresh contentWindow', () => {
    const { rerender } = render(<McpUiHost title="A view" html="<p>one</p>" sessionKey="a" />);
    const first = frame();
    rerender(<McpUiHost title="A view" html="<p>two</p>" sessionKey="b" />);
    expect(frame()).not.toBe(first);
    expect(frame().getAttribute('srcdoc')).toBe('<p>two</p>');
  });

  it('keys off the html itself when no session key is given', () => {
    const { rerender } = render(<McpUiHost title="A view" html="<p>one</p>" />);
    const first = frame();
    rerender(<McpUiHost title="A view" html="<p>one</p>" />);
    expect(frame()).toBe(first);
    rerender(<McpUiHost title="A view" html="<p>changed</p>" />);
    expect(frame()).not.toBe(first);
  });
});
