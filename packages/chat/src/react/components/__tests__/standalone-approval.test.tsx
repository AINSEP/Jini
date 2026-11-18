import { screen, waitFor } from '../../__tests__/fake-chat-kit.js';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { buildFormSurface } from '@jini-ai/ui/mcp-ui';
import type { McpUiHostProps } from '../../surfaces.js';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { registerMcpUiSurfaceRenderer } from '../McpUiSurfaceCard.js';
import { fakeChatSurfaces, renderWithChatSurfaces as renderWithSurfaces } from '../../__tests__/fake-chat-surfaces.js';
import { MessageRow } from '../MessageRow.js';
import { surfaceQuestionInput } from '../mcp-ui-question-input.js';

// The surfaces port supplies the MCP-UI host; this stub replaces the sandbox so tests drive its props boundary.
const StubHost = ({ onToolCall, title }: McpUiHostProps) => <section aria-label={title}><button onClick={() => {
    void onToolCall?.({ name: 'answer', arguments: { selections: ['site-guide'] } });
  }}>Use guide</button></section>;
const renderWithChatSurfaces = (ui: Parameters<typeof renderWithSurfaces>[0]) => renderWithSurfaces(ui, { surfaces: fakeChatSurfaces({ mcpUi: { Host: StubHost } }) });

const resource = buildFormSurface({
  uri: 'ui://approval/plugins', title: 'Agent plugins', toolName: 'answer', submitLabel: 'Use',
  fields: [{ kind: 'multi-enum', name: 'selections', label: 'Matching plugins',
    options: [{ value: 'site-guide', label: 'Site guide' }] }],
});
const events: AgentEvent[] = [{ kind: 'ext', name: 'mcp-ui', data: resource }];
const message: ChatMessage = { id: 'approval', role: 'assistant', content: '', events, runStatus: 'running' };
afterEach(() => clearExtEventRenderers());

it.each([false, true])('shows standalone option labels and title with an unrelated enclosing call: %s', async enclosingCall => {
  const execute = vi.fn().mockResolvedValue({ delivered: true });
  registerMcpUiSurfaceRenderer({ sandboxProxyUrl: new URL('https://sandbox.test/proxy.html'), onToolCall: execute });
  const ownedEvents: AgentEvent[] = enclosingCall ? [{ kind: 'tool_use', id: 'parent', name: 'update_page', input: {} }, ...events] : events;
  const view = renderWithChatSurfaces(<MessageRow message={{ ...message, events: ownedEvents }} runStreaming />);
  expect(screen.getByText('Waiting for your answer above')).toBeInTheDocument();
  expect(view.container.textContent).not.toContain('Thinking…');
  await userEvent.click(screen.getByRole('button', { name: 'Use guide' }));
  await waitFor(() => expect(view.container.querySelector('.mcpui-surface-card-closed')?.textContent).toBe('Agent plugins: Site guide'));
  expect(view.container.querySelector('.jini-message-user .jini-message-content')?.textContent).toBe('Agent plugins: Site guide');
  expect(view.container.textContent).not.toContain('site-guide');
  expect(screen.queryByText('Waiting for your answer above')).toBeNull();
  expect(execute).toHaveBeenCalledTimes(1);
});

it('reads native labels as inert text without running surface scripts or exposing callback params', () => {
  const input = surfaceQuestionInput({ resource: { ...resource, resource: { ...resource.resource,
    text: '<h1>Pick &amp; review</h1><script>window.__surfaceExecuted = true</script>' +
      '<input type="radio" id="odd:id" value="opaque"><label for="odd:id">Read &amp; review</label>' +
      '<select><option value="next">Continue</option></select>',
  } }, input: undefined });
  expect(input).toEqual({ title: 'Pick & review', options: [
    { value: 'opaque', label: 'Read & review' }, { value: 'next', label: 'Continue' },
  ] });
  expect((window as unknown as Record<string, unknown>).__surfaceExecuted).toBeUndefined();
});

it('keeps readable receipt text and displays the updated outcome after history reload', () => {
  registerMcpUiSurfaceRenderer({ sandboxProxyUrl: new URL('https://sandbox.test/proxy.html') });
  const savedEvents: AgentEvent[] = [
    { kind: 'tool_use', id: 'parent', name: 'update_page', input: {} }, ...events,
    { kind: 'ext', name: 'user_message', data: { id: 'receipt', toolUseId: 'parent', text: 'site-guide' } },
    { kind: 'tool_result', toolUseId: 'parent', content: '{"submitted":true,"selections":["site-guide"]}', isError: false },
    { kind: 'ext', name: 'mcp-ui', data: { ...resource, resource: { ...resource.resource, text: '<h1>Saved</h1>' } } },
  ];
  const renderSaved = () => renderWithChatSurfaces(<MessageRow message={{ ...message, events: JSON.parse(JSON.stringify(savedEvents)), runStatus: 'succeeded' }} />);
  const view = renderSaved();
  expect(view.container.querySelector('.jini-message-user .jini-message-content')?.textContent).toBe('Agent plugins: Site guide');
  expect(view.container.querySelector('.mcpui-surface-card-closed')).toBeNull();
  expect(screen.getByRole('region', { name: 'Saved' })).toBeInTheDocument();
  expect(view.container.querySelectorAll('.jini-message-user')).toHaveLength(1);
  view.unmount();
  const reloaded = renderSaved();
  expect(reloaded.container.querySelector('.jini-message-user .jini-message-content')?.textContent).toBe('Agent plugins: Site guide');
  expect(reloaded.container.querySelector('.mcpui-surface-card-closed')).toBeNull();
  expect(screen.getByRole('region', { name: 'Saved' })).toBeInTheDocument();
});
