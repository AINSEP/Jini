import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { ChatPane } from '../../features/chat-pane/components/ChatPane.js';
import { I18nContext } from '../../hooks/context.js';
import { createFakeChatTransport } from '../../hooks/testing/fake-transport.js';
import { MessageList } from '../MessageList.js';
import { MessageRow } from '../MessageRow.js';

const HOST_LABEL = 'Connecting to the assistant…';
const assistant: ChatMessage = { id: 'assistant', role: 'assistant', content: '', runStatus: 'queued' };

// Spreading the future optional prop keeps today's suite executable: it must fail on rendered
// behavior, rather than on a missing export or an excess-property TypeScript error.
function surface({ kind, sending = true, sendingLabel }: {
  kind: 'row' | 'list'; sending?: boolean; sendingLabel?: string;
}, _options = {}) {
  const host = sendingLabel === undefined ? {} : { sendingLabel };
  return kind === 'row'
    ? <MessageRow message={assistant} runStreaming runSending={sending} {...host} />
    : <MessageList messages={[
      { id: 'user', role: 'user', content: 'Hello', inputPending: sending }, assistant,
    ]} isStreaming {...host} />;
}

describe.each(['row', 'list'] as const)('%s sendingLabel', kind => {
  it('keeps the default Sending… text and restores it when the host removes its override', () => {
    const view = render(surface({ kind }));
    expect(screen.getByText('Sending…')).toBeVisible();
    view.rerender(surface({ kind, sendingLabel: HOST_LABEL }));
    expect(screen.getByText(HOST_LABEL)).toBeVisible();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    view.rerender(surface({ kind }));
    expect(screen.getByText('Sending…')).toBeVisible();
    expect(screen.queryByText(HOST_LABEL)).not.toBeInTheDocument();
  });

  it('shows the host label verbatim, without translating it again', () => {
    render(<I18nContext.Provider value={{ locale: 'test', t: key => `translated: ${key}` }}>
      {surface({ kind, sendingLabel: HOST_LABEL })}
    </I18nContext.Provider>);
    expect(screen.getByText(HOST_LABEL)).toBeVisible();
    expect(screen.queryByText(`translated: ${HOST_LABEL}`)).not.toBeInTheDocument();
    expect(screen.queryByText('translated: Sending…')).not.toBeInTheDocument();
  });

  it('stops showing the host label when the pending input is accepted, even if the prop remains', () => {
    const view = render(surface({ kind, sendingLabel: HOST_LABEL }));
    expect(screen.getByText(HOST_LABEL)).toBeVisible();
    view.rerender(surface({ kind, sending: false, sendingLabel: HOST_LABEL }));
    expect(screen.queryByText(HOST_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(screen.getByText('Thinking… 0 s')).toBeVisible();
  });
});

it('threads a changing host sendingLabel from the public ChatPane to its pending activity line', async () => {
  const transport = createFakeChatTransport();
  let accept!: () => void;
  const acceptance = new Promise<void>(resolve => { accept = resolve; });
  const startRun = transport.startRun;
  transport.startRun = vi.fn(async (input, handlers) => {
    await acceptance;
    return startRun(input, handlers);
  });
  const pane = ({ sendingLabel }: { sendingLabel: string }, _options = {}) => <ChatPane
    transport={transport} agents={[{ id: 'assistant', name: 'Assistant', available: true }]}
    {...{ sendingLabel }}
  />;
  const view = render(pane({ sendingLabel: HOST_LABEL }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
  expect(transport.startRun).toHaveBeenCalledOnce();
  expect(screen.getByText(HOST_LABEL)).toBeVisible();
  view.rerender(pane({ sendingLabel: 'Preparing the assistant…' }));
  expect(screen.getByText('Preparing the assistant…')).toBeVisible();
  expect(screen.queryByText(HOST_LABEL)).not.toBeInTheDocument();
  await act(async () => { accept(); });
  expect(screen.queryByText('Preparing the assistant…')).not.toBeInTheDocument();
  expect(screen.getByText('Thinking… 0 s')).toBeVisible();
  act(() => transport.finish([]));
});
