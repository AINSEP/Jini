import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import type { ChatMessage } from '../../../core/index.js';
import { createToolRendererRegistry, registerToolRenderer, getToolRenderer, clearToolRenderers } from '../../tool-renderer-registry.js';
import { createExtEventRendererRegistry, registerExtEventRenderer, getExtEventRenderer, extEventSlot, clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { JiniChatProvider } from '../JiniChatProvider.js';
import { MessageRow } from '../MessageRow.js';
import { McpUiSurfaceCard, mcpUiSurfaceSlotKey, registerMcpUiSurfaceRenderer } from '../McpUiSurfaceCard.js';
import { createFakeChatTransport } from '../../hooks/testing/fake-transport.js';

const transport = createFakeChatTransport();
const resource = (uri: string) => ({ type: 'resource', resource: { uri, mimeType: 'text/html', text: '<p>choice</p>' } });
const events: NonNullable<ChatMessage['events']> = [
  { kind: 'tool_use', id: 't1', name: 'Probe', input: {} },
  { kind: 'ext', name: 'mcp-ui', data: resource('ui://first') },
  { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
  { kind: 'text', text: 'Between cards.' },
  { kind: 'tool_use', id: 't2', name: 'Probe', input: {} },
  { kind: 'ext', name: 'mcp-ui', data: resource('ui://second') },
];
const message: ChatMessage = { id: 'same-message', role: 'assistant', content: 'Between cards.', events, runId: 'same-run', runStatus: 'running' };

afterEach(() => { clearToolRenderers({}); clearExtEventRenderers(); });

describe('owned renderer registries', () => {
  it('isolates two simultaneous trees, including nested bindings with different slot keys', () => {
    const firstTools = createToolRendererRegistry({}), secondTools = createToolRendererRegistry({});
    const firstExtensions = createExtEventRendererRegistry({}), secondExtensions = createExtEventRendererRegistry({});
    firstTools.register({ name: 'Probe', renderer: () => <span>first tool</span> });
    secondTools.register({ name: 'Probe', renderer: () => <span>second tool</span> });
    firstExtensions.register({ name: 'mcp-ui', renderer: props => <span>{`first cards: ${props.events.length}`}</span> }, { slotKey: mcpUiSurfaceSlotKey });
    secondExtensions.register({ name: 'mcp-ui', renderer: props => <span>{`second cards: ${props.events.length}`}</span> });
    render(<JiniChatProvider transport={transport} toolRendererRegistry={firstTools} extEventRendererRegistry={firstExtensions}>
      <section data-testid="outer"><MessageRow message={message} runStreaming /></section>
      <JiniChatProvider transport={transport} toolRendererRegistry={secondTools} extEventRendererRegistry={secondExtensions}>
        <section data-testid="inner"><MessageRow message={message} runStreaming /></section>
      </JiniChatProvider>
      <section data-testid="outer-after"><MessageRow message={message} runStreaming /></section>
    </JiniChatProvider>);
    for (const id of ['outer', 'outer-after']) {
      const tree = within(screen.getByTestId(id));
      expect(tree.getAllByText('first tool')).toHaveLength(2);
      expect(tree.getAllByText('first cards: 1')).toHaveLength(2);
      expect(tree.queryByText('second tool')).toBeNull();
    }
    const inner = within(screen.getByTestId('inner'));
    expect(inner.getAllByText('second tool')).toHaveLength(2);
    expect(inner.getAllByText('second cards: 2')).toHaveLength(1);
    expect(inner.queryByText('first tool')).toBeNull();
  });

  it('stale unregister handles cannot remove replacements, even with the same renderer callback', () => {
    const tools = createToolRendererRegistry({}), extensions = createExtEventRendererRegistry({});
    const renderer = () => null;
    const oldTool = tools.register({ name: 'same', renderer });
    const currentTool = tools.register({ name: 'same', renderer });
    const oldExt = extensions.register({ name: 'same', renderer }, { slotKey: () => 'old' });
    const currentExt = extensions.register({ name: 'same', renderer }, { slotKey: () => 'new' });
    oldTool(); oldExt();
    expect(tools.get({ name: 'same' })).toBe(renderer);
    expect(extensions.get({ name: 'same' })).toBe(renderer);
    expect(extensions.slot({ name: 'same', data: {} })).toBe('same:new');
    currentTool(); currentExt();
    expect(tools.get({ name: 'same' })).toBeUndefined();
    expect(extensions.get({ name: 'same' })).toBeUndefined();
  });

  it('MCP slots keep their positions, call ownership and delivered answers separate', () => {
    const extensions = createExtEventRendererRegistry({});
    extensions.register({ name: 'mcp-ui', renderer: props => {
      const uri = mcpUiSurfaceSlotKey({ data: props.events[0] });
      return <button onClick={props.onAnswered} data-testid={uri} data-answered={props.answered} data-call-result={props.call?.result?.content ?? 'pending'}>{uri}</button>;
    } }, { slotKey: mcpUiSurfaceSlotKey });
    render(<JiniChatProvider transport={transport} extEventRendererRegistry={extensions}>
      <MessageRow message={message} runStreaming />
    </JiniChatProvider>);
    const first = screen.getByTestId('ui://first'), second = screen.getByTestId('ui://second');
    const narration = screen.getByText('Between cards.');
    expect(first.compareDocumentPosition(narration) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(narration.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(first).toHaveAttribute('data-call-result', 'ok');
    expect(second).toHaveAttribute('data-call-result', 'pending');
    expect(document.querySelector('.jini-run-activity')?.textContent).toBe('Waiting for your answer above');
    fireEvent.click(second);
    expect(second).toHaveAttribute('data-answered', 'true');
    expect(first).toHaveAttribute('data-answered', 'false');
    expect(document.querySelector('.jini-run-activity')?.textContent).toMatch(/^Running Probe… \d+ s$/);
  });

  it('MCP registration binds the supplied registry without changing the global default', () => {
    const extensions = createExtEventRendererRegistry({});
    const sandboxProxyUrl = new URL('https://sandbox.test/sandbox_proxy.html');
    const unregister = registerMcpUiSurfaceRenderer({ registry: extensions, sandboxProxyUrl });
    expect(getExtEventRenderer({ name: 'mcp-ui' })).toBeUndefined();
    expect(extensions.slot({ name: 'mcp-ui', data: resource('ui://first') })).toBe('mcp-ui:ui://first');
    expect(extensions.slot({ name: 'mcp-ui', data: resource('ui://second') })).toBe('mcp-ui:ui://second');
    const node = extensions.get({ name: 'mcp-ui' })!({ name: 'mcp-ui', events: [resource('ui://first')], runStreaming: true, runSucceeded: false, runId: 'run' });
    expect(isValidElement(node)).toBe(true);
    if (!isValidElement<{ sandboxProxyUrl: URL }>(node)) throw new Error('MCP renderer did not return a component');
    expect(node.type).toBe(McpUiSurfaceCard);
    expect(node.props.sandboxProxyUrl).toBe(sandboxProxyUrl);
    unregister();
    expect(extensions.get({ name: 'mcp-ui' })).toBeUndefined();
  });

  it('global registration, lookup, slot grouping, rendering and cleanup remain compatible', () => {
    const unregisterTool = registerToolRenderer({ name: 'Probe', renderer: () => <span>global tool</span> });
    const unregisterExt = registerExtEventRenderer({ name: 'mcp-ui', renderer: props => <span>{`global card: ${props.events.length}`}</span> }, { slotKey: mcpUiSurfaceSlotKey });
    expect(getToolRenderer({ name: 'Probe' })).toBeTypeOf('function');
    expect(getExtEventRenderer({ name: 'mcp-ui' })).toBeTypeOf('function');
    expect(extEventSlot({ name: 'mcp-ui', data: resource('ui://first') })).toBe('mcp-ui:ui://first');
    render(<JiniChatProvider transport={transport}><MessageRow message={message} runStreaming /></JiniChatProvider>);
    expect(screen.getAllByText('global tool')).toHaveLength(2);
    expect(screen.getAllByText('global card: 1')).toHaveLength(2);
    unregisterTool(); unregisterExt();
    expect(getToolRenderer({ name: 'Probe' })).toBeUndefined();
    expect(getExtEventRenderer({ name: 'mcp-ui' })).toBeUndefined();
  });
});
