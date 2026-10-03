/**
 * `McpUiSurfaceCard` after the `@jini-ai/ui` `@mcp-ui/client` swap (see `useMcpUiHost.ts`'s module
 * doc in `@jini-ai/ui` for the full picture). Every View this card renders now mounts through the
 * real `AppRenderer` rather than a hand-rolled `srcdoc` iframe — a real, separately-served sandbox
 * proxy page is required, so every test below supplies one (a fake but well-formed URL; jsdom does
 * not actually navigate to it, matching the same boundary this session's PoC and `McpUiHost.test.tsx`
 * both draw: assert on `AppRenderer`'s real, unmocked, synchronous mount behavior, not on a live
 * handshake jsdom cannot perform).
 *
 * One test the OLD suite had is INTENTIONALLY NOT reproduced here: driving a real `size-changed`
 * report through to a clamped height. That relied on `host-message-source.ts`'s shared `window`
 * listener, which `@mcp-ui/client`'s `AppRenderer` does not expose an equivalent seam for — the
 * equivalent behavior (maxHeight clamping a real onSizeChanged report) is covered directly, by
 * invoking the real callback function, in `@jini-ai/ui`'s `useMcpUiHost.test.tsx`.
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_UI_EXT_EVENT_NAME, McpUiSurfaceCard, mcpUiSurfaceSlotKey, registerMcpUiSurfaceRenderer } from '../McpUiSurfaceCard.js';
import { MCP_UI_ACTION_PLAN_META_KEY, MCP_UI_MIME_TYPE, MCP_UI_PREFERRED_FRAME_SIZE_META_KEY } from '@jini-ai/ui/mcp-ui';
import { clearExtEventRenderers, extEventSlot, getExtEventRenderer } from '../../ext-event-renderer-registry.js';

const SANDBOX_URL = new URL('https://sandbox.example.test/sandbox_proxy.html');

function resourceEvent(uri: string, text: string, meta?: Record<string, unknown>) {
  return {
    type: 'resource',
    resource: { uri, mimeType: MCP_UI_MIME_TYPE, text, ...(meta === undefined ? {} : { _meta: meta }) },
  };
}

const BASE_PROPS = {
  name: MCP_UI_EXT_EVENT_NAME,
  runStreaming: false,
  runSucceeded: true,
  runId: 'run-1',
  sandboxProxyUrl: SANDBOX_URL,
} as const;

afterEach(() => {
  clearExtEventRenderers();
});

describe('McpUiSurfaceCard', () => {
  describe('a question nobody can answer any more is shown closed, not answerable', () => {
    const card = [resourceEvent('ui://consumer/ask-choice/x/1', '<form>pick one</form>')];
    const askCall = { name: 'assistant_ask_choice', input: { title: 'Pick a plan' } };

    it('shows "Answered" once its tool call has the answer, with no live frame', () => {
      const { container, getByRole } = render(
        <McpUiSurfaceCard {...BASE_PROPS} runStreaming events={card} call={{ ...askCall, result: { content: '{"submitted":true,"choice":"Alpha"}', isError: false } }} />,
      );
      expect(getByRole('status').textContent).toBe('Pick a plan: Answered');
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('shows "This question expired" when the call ended without an answer', () => {
      const { container, getByRole } = render(
        <McpUiSurfaceCard
          {...BASE_PROPS}
          runStreaming
          events={card}
          call={{ ...askCall, result: { content: '{"submitted":false,"reason":"expired","note":"The administrator did not respond before the form expired."}', isError: false } }}
        />,
      );
      expect(getByRole('status').textContent).toBe('Pick a plan: This question expired');
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('shows "This question expired" when the run ended while the question was still open', () => {
      const { container, getByRole } = render(<McpUiSurfaceCard {...BASE_PROPS} runStreaming={false} events={card} call={askCall} />);
      expect(getByRole('status').textContent).toBe('Pick a plan: This question expired');
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('stays live while the run is streaming and the call is waiting', async () => {
      const { container } = render(<McpUiSurfaceCard {...BASE_PROPS} runStreaming events={card} call={askCall} />);
      await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(1));
    });

    it('keeps showing an outcome the tool sent back for the same card after the answer', async () => {
      const { container } = render(
        <McpUiSurfaceCard
          {...BASE_PROPS}
          events={[...card, resourceEvent('ui://consumer/ask-choice/x/1', '<p>Saved.</p>')]}
          call={{ ...askCall, result: { content: '{"saved":true}', isError: false } }}
        />,
      );
      await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(1));
    });
  });

  it('renders one real sandboxed iframe per resource, pointed at the given sandbox proxy URL', async () => {
    const { container } = render(<McpUiSurfaceCard {...BASE_PROPS} events={[resourceEvent('ui://a/1', '<p>one</p>')]} />);
    await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(1));
    const frame = container.querySelector('iframe')!;
    expect(frame.src).toBe(SANDBOX_URL.href);
  });

  it('collapses repeated events for one URI to the latest document, not two dialogs', async () => {
    const { container } = render(
      <McpUiSurfaceCard
        {...BASE_PROPS}
        events={[resourceEvent('ui://a/1', '<p>first</p>'), resourceEvent('ui://a/1', '<p>second</p>')]}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(1));
    // One resource, one card wrapper — the "second" event replaced "first" rather than stacking.
    expect(container.querySelectorAll('[data-mcpui-host]')).toHaveLength(1);
  });

  it('renders distinct URIs as separate views, in first-appearance order', async () => {
    const { container } = render(
      <McpUiSurfaceCard
        {...BASE_PROPS}
        events={[resourceEvent('ui://a/1', '<p>a</p>'), resourceEvent('ui://b/2', '<p>b</p>'), resourceEvent('ui://a/1', '<p>a2</p>')]}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-mcpui-host]')).toHaveLength(2));
    const wrappers = [...container.querySelectorAll('[data-mcpui-host]')];
    expect(wrappers.map((wrapper) => wrapper.getAttribute('aria-label'))).toEqual(['ui://a/1', 'ui://b/2']);
  });

  it('honors a preferred frame height as the initial (pre-handshake) height, and ignores a non-pixel one', () => {
    const { container } = render(
      <McpUiSurfaceCard
        {...BASE_PROPS}
        events={[
          resourceEvent('ui://a/1', '<p>a</p>', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['400px', '480px'] }),
          resourceEvent('ui://b/2', '<p>b</p>', { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: ['auto', 'auto'] }),
          resourceEvent('ui://c/3', '<p>c</p>'),
        ]}
      />,
    );
    const wrapperFor = (uri: string) =>
      [...container.querySelectorAll('[data-mcpui-host]')].find((el) => el.getAttribute('aria-label') === uri) as HTMLElement;
    expect(wrapperFor('ui://a/1').style.height).toBe('480px');
    // "auto" parses to NaN — falling back to the default beats rendering height: NaNpx.
    expect(wrapperFor('ui://b/2').style.height).toBe('220px');
    expect(wrapperFor('ui://c/3').style.height).toBe('220px');
  });

  it('says so visibly when an mcp-ui event carried nothing renderable', () => {
    const { container, getByRole, queryByLabelText } = render(
      <McpUiSurfaceCard {...BASE_PROPS} events={[{ type: 'text', text: 'not a resource' }, null]} />,
    );
    expect(getByRole('status').textContent).toBe('This MCP-UI event carried no renderable resource.');
    expect(queryByLabelText(/ui:\/\//)).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  describe('the agent-visible mirror (Task 2b)', () => {
    const PLAN = {
      title: 'Publish the site?',
      actions: [{ id: 'confirm', label: 'Publish', variant: 'danger' }, { id: 'cancel', label: 'Cancel' }],
    };

    it('publishes a status-role, agent-discoverable region when the resource carries an action plan', () => {
      const { container } = render(
        <McpUiSurfaceCard
          {...BASE_PROPS}
          events={[resourceEvent('ui://consumer/deployment-execute-static-publish/abc123', '<p>a</p>', { [MCP_UI_ACTION_PLAN_META_KEY]: PLAN })]}
        />,
      );
      const mirror = container.querySelector('[data-agent-role="status"]');
      expect(mirror).not.toBeNull();
      expect(mirror).toHaveAttribute('data-agent-element', 'mcp-ui-pending-ui-consumer-deployment-execute-static-publish-abc123');
      expect(mirror).toHaveAttribute('aria-hidden', 'true');
      expect(mirror?.getAttribute('data-agent-label')).toContain('Publish the site?');
      expect(mirror?.getAttribute('data-agent-label')).toContain('Publish');
      expect(mirror?.getAttribute('data-agent-label')).toContain('Cancel');
    });

    it('hides the mirror from sighted users too, not just screen readers — the real dialog is already visible in the frame', () => {
      const { container } = render(
        <McpUiSurfaceCard
          {...BASE_PROPS}
          events={[resourceEvent('ui://a/1', '<p>a</p>', { [MCP_UI_ACTION_PLAN_META_KEY]: PLAN })]}
        />,
      );
      const mirror = container.querySelector('[data-agent-role="status"]') as HTMLElement;
      expect(mirror.style.display).toBe('none');
    });

    it('renders no mirror at all for a surface with no action plan (e.g. a non-confirmation view)', () => {
      const { container } = render(<McpUiSurfaceCard {...BASE_PROPS} events={[resourceEvent('ui://a/1', '<p>a</p>')]} />);
      expect(container.querySelector('[data-agent-role="status"]')).toBeNull();
    });

    it('never gives an individual action its own data-agent-element handle -- page.click does not consult data-agent-role, so publishing one would let the same live agent answer its own confirmation', () => {
      const { container } = render(
        <McpUiSurfaceCard
          {...BASE_PROPS}
          events={[resourceEvent('ui://a/1', '<p>a</p>', { [MCP_UI_ACTION_PLAN_META_KEY]: PLAN })]}
        />,
      );
      // The mirror region itself is the only [data-agent-element] node this component renders in
      // the parent DOM — no per-action "confirm"/"cancel" handle anywhere outside the sandboxed frame.
      const tagged = [...container.querySelectorAll('[data-agent-element]')];
      expect(tagged).toHaveLength(1);
      expect(tagged[0]).toHaveAttribute('data-agent-role', 'status');
    });
  });

  it('passes the tool executor and link handler through to each view without throwing', async () => {
    const onToolCall = vi.fn();
    const onOpenLink = vi.fn();
    // Rendering without throwing is what this proves at this layer: `useMcpUiHost` reads them from
    // its options, and the protocol paths that actually CALL them are covered directly (invoking the
    // real onCallTool/onOpenLink functions) in `@jini-ai/ui`'s `useMcpUiHost.test.tsx`.
    const { container } = render(
      <McpUiSurfaceCard {...BASE_PROPS} events={[resourceEvent('ui://a/1', '<p>a</p>')]} onToolCall={onToolCall} onOpenLink={onOpenLink} />,
    );
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  });
});

describe('registerMcpUiSurfaceRenderer', () => {
  it('claims the mcp-ui ext-event name and renders through the card', async () => {
    const onToolCall = vi.fn();
    const onOpenLink = vi.fn();
    const unregister = registerMcpUiSurfaceRenderer({ sandboxProxyUrl: SANDBOX_URL, onToolCall, onOpenLink });

    const renderer = getExtEventRenderer({ name: MCP_UI_EXT_EVENT_NAME });
    expect(renderer).toBeTypeOf('function');
    const { container } = render(<>{renderer!({ ...BASE_PROPS, events: [resourceEvent('ui://a/1', '<p>a</p>')] })}</>);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());

    unregister();
    expect(getExtEventRenderer({ name: MCP_UI_EXT_EVENT_NAME })).toBeUndefined();
  });

  it('registers with only the required sandboxProxyUrl', async () => {
    registerMcpUiSurfaceRenderer({ sandboxProxyUrl: SANDBOX_URL });
    const renderer = getExtEventRenderer({ name: MCP_UI_EXT_EVENT_NAME })!;
    const { container } = render(<>{renderer({ ...BASE_PROPS, events: [resourceEvent('ui://a/1', '<p>a</p>')] })}</>);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  });

  // host stuck-chat investigation, 2026-09-27: each MCP-UI resource is its own card, so each gets
  // its own transcript slot, keyed by URI; a non-resource payload stays in the shared slot.
  it('keys each MCP-UI resource into its own slot by URI', () => {
    registerMcpUiSurfaceRenderer({ sandboxProxyUrl: SANDBOX_URL });

    expect(extEventSlot({ name: MCP_UI_EXT_EVENT_NAME, data: resourceEvent('ui://consumer/ask-choice/1', '<p>a</p>') })).toBe('mcp-ui:ui://consumer/ask-choice/1');
    expect(extEventSlot({ name: MCP_UI_EXT_EVENT_NAME, data: { not: 'a resource' } })).toBe('mcp-ui');
    expect(mcpUiSurfaceSlotKey({ data: resourceEvent('ui://x/2', '<p>b</p>') })).toBe('ui://x/2');
  });

  it('can claim a different name for a host multiplexing two streams', () => {
    registerMcpUiSurfaceRenderer({ sandboxProxyUrl: SANDBOX_URL, name: 'mcp-ui-secondary' });
    expect(getExtEventRenderer({ name: 'mcp-ui-secondary' })).toBeTypeOf('function');
    expect(getExtEventRenderer({ name: MCP_UI_EXT_EVENT_NAME })).toBeUndefined();
  });
});
