import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { buildFormSurface, type McpUiHostProps } from '@jini-ai/ui/mcp-ui';
import { acceptedInputUserEvent } from '../../../core/accepted-input.js';
import { SURFACE_QUESTION_META_KEY } from '../../../core/question-answer.js';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { clearExtEventRenderers } from '../../ext-event-renderer-registry.js';
import { registerMcpUiSurfaceRenderer } from '../McpUiSurfaceCard.js';
import { MessageRow } from '../MessageRow.js';

vi.mock('@jini-ai/ui/mcp-ui', async original => ({
  ...await original<typeof import('@jini-ai/ui/mcp-ui')>(),
  McpUiHost: ({ onToolCall, title }: McpUiHostProps) => <section aria-label={title}>
    <button onClick={() => { void onToolCall?.({ name: 'answer', arguments: { selections: ['github'], __choiceAction: 'use' } }); }}>Use</button>
    <button onClick={() => { void onToolCall?.({ name: 'answer', arguments: { selections: ['github'], __choiceAction: 'auto' } }); }}>Don't ask again</button>
    <button onClick={() => { void onToolCall?.({ name: 'answer', arguments: { __dismissed: true } }); }}>Skip</button>
  </section>,
}));

const uri = 'ui://host/ask-choice/principal/one';
const question = { title: 'Agent plugins', options: [{ value: 'github', label: 'GitHub' }] };
function card(surfaceUri = uri): AgentEvent {
  const ui = buildFormSurface({ uri: surfaceUri as `ui://${string}`, title: question.title, toolName: 'answer', submitLabel: 'Use',
    fields: [{ kind: 'multi-enum', name: 'selections', label: 'Matching plugins',
      options: [{ value: 'github', label: 'GitHub — Lets the assistant use the repository' }] }],
  });
  return { kind: 'ext', name: 'mcp-ui', data: { ...ui, resource: { ...ui.resource,
    _meta: { ...ui.resource._meta, [SURFACE_QUESTION_META_KEY]: question },
  } } };
}
function message(events: AgentEvent[], runStatus: ChatMessage['runStatus'] = 'running'): ChatMessage {
  return { id: 'approval', role: 'assistant', content: '', events, runStatus };
}
function receipt(surfaceUri = uri): AgentEvent {
  return acceptedInputUserEvent({ input: { id: `answer:${surfaceUri}`, text: 'Agent plugins: GitHub', answerText: 'GitHub', surfaceUri } }, { receipt: 'accepted' });
}
/** Text outside tool panels: an enclosing call's own input legitimately renders its raw values. */
function transcriptText(container: HTMLElement) {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.op-card').forEach(node => node.remove());
  return copy.textContent;
}
function bubbles(container: HTMLElement) {
  return [...container.querySelectorAll('.jini-message-user .jini-message-content')].map(node => node.textContent);
}
afterEach(() => clearExtEventRenderers());

it.each([false, true])('uses the resource question for live title/labels with an unrelated enclosing call: %s', async enclosing => {
  const execute = vi.fn().mockResolvedValue({ delivered: true });
  registerMcpUiSurfaceRenderer({ sandboxProxyUrl: new URL('https://sandbox.test/proxy.html'), onToolCall: execute });
  const events: AgentEvent[] = enclosing ? [{ kind: 'tool_use', id: 'parent', name: 'update',
    input: { options: [{ value: 'github', label: 'Unrelated option' }] } }, card()] : [card()];
  const view = render(<MessageRow message={message(events)} runStreaming />);
  expect(screen.getByRole('region', { name: 'Agent plugins' }).getAttribute('aria-label')).toBe('Agent plugins');
  expect(screen.getByText('Waiting for your answer above').textContent).toBe('Waiting for your answer above');
  await userEvent.click(screen.getByRole('button', { name: 'Use' }));
  await waitFor(() => expect(bubbles(view.container)).toEqual(['Agent plugins: GitHub']));
  expect(view.container.querySelector('.mcpui-surface-card-closed')?.textContent).toBe('Agent plugins: GitHub');
  expect(transcriptText(view.container)).not.toContain('github');
  expect(transcriptText(view.container)).not.toContain('Lets the assistant');
  for (const name of ['Use', "Don't ask again", 'Skip']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByText('Waiting for your answer above')).toBeNull();
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each(['running', 'succeeded', 'failed', 'canceled'] as const)('keeps a resource-bound answer collapsed after JSON reload and duplicate replay (%s)', runStatus => {
  const execute = vi.fn();
  registerMcpUiSurfaceRenderer({ sandboxProxyUrl: new URL('https://sandbox.test/proxy.html'), onToolCall: execute });
  const saved: AgentEvent[] = JSON.parse(JSON.stringify([card(), receipt(), receipt()]));
  const mount = () => render(<MessageRow message={message(saved, runStatus)} runStreaming />);
  const first = mount();
  expect(bubbles(first.container)).toEqual(['Agent plugins: GitHub']);
  first.unmount();
  const reloaded = mount();
  expect(bubbles(reloaded.container)).toEqual(['Agent plugins: GitHub']);
  expect(reloaded.container.querySelector('.mcpui-surface-card-closed')?.textContent).toBe('Agent plugins: GitHub');
  expect(screen.queryByRole('button', { name: 'Use' })).toBeNull();
  expect(screen.queryByRole('button', { name: "Don't ask again" })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  expect(screen.queryByRole('region', { name: uri })).toBeNull();
  expect(screen.queryByText('Waiting for your answer above')).toBeNull();
  expect(execute).not.toHaveBeenCalled();
});

it('does not close a second surface with the same labels when the first receipt is replayed', () => {
  registerMcpUiSurfaceRenderer({ sandboxProxyUrl: new URL('https://sandbox.test/proxy.html') });
  const view = render(<MessageRow message={message([card(), receipt(), card('ui://host/ask-choice/principal/two')])} runStreaming />);
  expect(bubbles(view.container)).toEqual(['Agent plugins: GitHub']);
  expect(view.container.querySelectorAll('.mcpui-surface-card-closed')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Use' })).toHaveLength(1);
  expect(screen.getByText('Waiting for your answer above').textContent).toBe('Waiting for your answer above');
});
