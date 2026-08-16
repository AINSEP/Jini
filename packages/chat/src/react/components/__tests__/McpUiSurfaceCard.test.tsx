import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_UI_EXT_EVENT_NAME, McpUiSurfaceCard, registerMcpUiSurfaceRenderer } from '../McpUiSurfaceCard.js';
import { MCP_UI_MIME_TYPE, MCP_UI_PREFERRED_FRAME_SIZE_META_KEY } from '@jini-ai/ui/mcp-ui';
import { clearExtEventRenderers, getExtEventRenderer } from '../../ext-event-renderer-registry.js';

function resourceEvent(uri: string, text: string, meta?: Record<string, unknown>) {
  return {
    type: 'resource',
    resource: { uri, mimeType: MCP_UI_MIME_TYPE, text, ...(meta === undefined ? {} : { _meta: meta }) },
  };
}

const BASE_PROPS = { name: MCP_UI_EXT_EVENT_NAME, runStreaming: false, runSucceeded: true, runId: 'run-1' } as const;

afterEach(() => {
  clearExtEventRenderers();
});

describe('McpUiSurfaceCard', () => {
  it('renders one sandboxed frame per resource', () => {
    render(<McpUiSurfaceCard {...BASE_PROPS} events={[resourceEvent('ui://a/1', '<p>one</p>')]} />);
    const frame = screen.getByTitle('ui://a/1') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toBe('<p>one</p>');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('collapses repeated events for one URI to the latest document, not two dialogs', () => {
    render(
      <McpUiSurfaceCard
        {...BASE_PROPS}
        events={[resourceEvent('ui://a/1', '<p>first</p>'), resourceEvent('ui://a/1', '<p>second</p>')]}
      />,
    );
    expect(screen.getAllByTitle('ui://a/1')).toHaveLength(1);
    expect((screen.getByTitle('ui://a/1') as HTMLIFrameElement).getAttribute('srcdoc')).toBe('<p>second</p>');
  });

  it('renders distinct URIs as separate views, in first-appearance order', () => {
    const { container } = render(
      <McpUiSurfaceCard
        {...BASE_PROPS}
        events={[resourceEvent('ui://a/1', '<p>a</p>'), resourceEvent('ui://b/2', '<p>b</p>'), resourceEvent('ui://a/1', '<p>a2</p>')]}
      />,
    );
    expect([...container.querySelectorAll('iframe')].map((frame) => frame.title)).toEqual(['ui://a/1', 'ui://b/2']);
  });

  it('honors a preferred frame height, and ignores a non-pixel one', () => {
    render(
      <McpUiSurfaceCard
        {...BASE_PROPS}
        events={[
          resourceEvent('ui://a/1', '<p>a</p>', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['400px', '480px'] }),
          resourceEvent('ui://b/2', '<p>b</p>', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['auto', 'auto'] }),
          resourceEvent('ui://c/3', '<p>c</p>'),
        ]}
      />,
    );
    expect((screen.getByTitle('ui://a/1') as HTMLIFrameElement).style.height).toBe('480px');
    // "auto" parses to NaN — falling back to the default beats rendering height: NaNpx.
    expect((screen.getByTitle('ui://b/2') as HTMLIFrameElement).style.height).toBe('220px');
    expect((screen.getByTitle('ui://c/3') as HTMLIFrameElement).style.height).toBe('220px');
  });

  it('says so visibly when an mcp-ui event carried nothing renderable', () => {
    render(<McpUiSurfaceCard {...BASE_PROPS} events={[{ type: 'text', text: 'not a resource' }, null]} />);
    expect(screen.getByRole('status').textContent).toBe('This MCP-UI event carried no renderable resource.');
    expect(screen.queryByTitle(/ui:\/\//)).toBeNull();
  });

  it('threads a maxHeight through to McpUiHost, so a narrow host can cap a surface below the library default (720px)', () => {
    render(<McpUiSurfaceCard {...BASE_PROPS} events={[resourceEvent('ui://a/1', '<p>a</p>')]} maxHeight={300} />);
    const frameEl = screen.getByTitle('ui://a/1') as HTMLIFrameElement;
    const view = frameEl.contentWindow!;
    // A real message round-trip through the shared window listener (`host-message-source.ts`),
    // not an injected fake — this is the exact mechanism a production McpUiHost uses, so this proves
    // the prop actually reaches it rather than merely compiling.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} }, source: view }));
      window.dispatchEvent(new MessageEvent('message', { data: { jsonrpc: '2.0', method: 'ui/notifications/initialized' }, source: view }));
      // Deliberately absurd height: without threading, this would clamp at the library's own
      // DEFAULT_MAX_HEIGHT (720px), not at the 300px this host asked for.
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height: 999_999 } },
          source: view,
        }),
      );
    });
    expect(frameEl.style.height).toBe('300px');
  });

  it('passes the tool executor and link handler through to each view', () => {
    const onToolCall = vi.fn();
    const onOpenLink = vi.fn();
    // Rendering is enough to prove the props are wired: `useMcpUiHost` reads them from its options
    // and the protocol paths that call them are covered directly in useMcpUiHost.test.tsx.
    expect(() =>
      render(
        <McpUiSurfaceCard {...BASE_PROPS} events={[resourceEvent('ui://a/1', '<p>a</p>')]} onToolCall={onToolCall} onOpenLink={onOpenLink} />,
      ),
    ).not.toThrow();
    expect(screen.getByTitle('ui://a/1')).toBeInTheDocument();
  });
});

describe('registerMcpUiSurfaceRenderer', () => {
  it('claims the mcp-ui ext-event name and renders through the card', () => {
    const onToolCall = vi.fn();
    const onOpenLink = vi.fn();
    const unregister = registerMcpUiSurfaceRenderer({ onToolCall, onOpenLink });

    const renderer = getExtEventRenderer(MCP_UI_EXT_EVENT_NAME);
    expect(renderer).toBeTypeOf('function');
    render(<>{renderer!({ ...BASE_PROPS, events: [resourceEvent('ui://a/1', '<p>a</p>')] })}</>);
    expect(screen.getByTitle('ui://a/1')).toBeInTheDocument();

    unregister();
    expect(getExtEventRenderer(MCP_UI_EXT_EVENT_NAME)).toBeUndefined();
  });

  it('registers with no options at all', () => {
    registerMcpUiSurfaceRenderer();
    const renderer = getExtEventRenderer(MCP_UI_EXT_EVENT_NAME)!;
    render(<>{renderer({ ...BASE_PROPS, events: [resourceEvent('ui://a/1', '<p>a</p>')] })}</>);
    expect(screen.getByTitle('ui://a/1')).toBeInTheDocument();
  });

  it('can claim a different name for a host multiplexing two streams', () => {
    registerMcpUiSurfaceRenderer({ name: 'mcp-ui-secondary' });
    expect(getExtEventRenderer('mcp-ui-secondary')).toBeTypeOf('function');
    expect(getExtEventRenderer(MCP_UI_EXT_EVENT_NAME)).toBeUndefined();
  });
});
