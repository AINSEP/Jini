/**
 * Typing in the composer must not re-render the transcript. Owner report 2026-10-08: in a long
 * conversation (hundreds of tool rows, a dozen MCP-UI cards) every keystroke re-rendered every
 * message row, ~750 ms per key in the dev build. The probe below is an ext-event renderer, which
 * `MessageRow` calls on every one of its own renders — so its call count is the row's render count.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@jini-ai/chat';
import { clearExtEventRenderers, registerExtEventRenderer } from '../../../../ext-event-renderer-registry.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { ChatPane } from '../../components/ChatPane.js';
import type { ChatPaneAgent } from '../../types.js';

const agents: ChatPaneAgent[] = [{ id: 'codex', name: 'Codex CLI', available: true }];

const transcript: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Build me a page', createdAt: 1 },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Done.',
    runStatus: 'succeeded',
    createdAt: 2,
    events: [{ kind: 'ext', name: 'render-probe', data: { n: 1 } }],
  },
];

describe('ChatPane typing', () => {
  afterEach(() => clearExtEventRenderers());

  it('does not re-render message rows on each keystroke', () => {
    let rowRenders = 0;
    registerExtEventRenderer({ name: 'render-probe', renderer: () => {
      rowRenders += 1;
      return <div data-testid="probe">probe</div>;
    } });
    render(
      <ChatPane
        transport={createFakeChatTransport()}
        agents={agents}
        initialMessages={transcript}
        conversationId="c1"
        placeholder="Ask"
        projectFileNames={new Set(['index.html'])}
      />,
    );
    expect(screen.getByTestId('probe')).toBeInTheDocument();
    const before = rowRenders;

    const textarea = screen.getByPlaceholderText('Ask');
    let text = '';
    for (const ch of 'hello there') {
      text += ch;
      fireEvent.change(textarea, { target: { value: text } });
    }

    expect(textarea).toHaveValue('hello there');
    expect(rowRenders).toBe(before);
  });
});
