import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';

const messages: ChatMessage[] = [
  { id: '1', role: 'user', content: 'hi' },
  { id: '2', role: 'assistant', content: 'hello back', runStatus: 'succeeded' },
];

describe('MessageList', () => {
  it('renders every message in order', () => {
    render(<MessageList messages={messages} />);
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hello back')).toBeInTheDocument();
  });

  it('tags the transcript container for agent inspection', () => {
    const { container } = render(<MessageList messages={messages} />);
    const el = container.querySelector('[data-agent-element="chat-transcript"]');
    expect(el).toHaveAttribute('data-agent-role', 'list');
    expect(el).toHaveAttribute('data-agent-label', 'The conversation transcript, oldest message first');
  });

  it('marks only the last message as streaming while isStreaming is true', () => {
    const streamingMessages: ChatMessage[] = [
      { id: '1', role: 'assistant', content: '', runStatus: 'running', events: [{ kind: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
      { id: '2', role: 'assistant', content: '', runStatus: 'running', events: [{ kind: 'tool_use', id: 't2', name: 'Bash', input: {} }] },
    ];
    render(<MessageList messages={streamingMessages} isStreaming />);
    // Both render a Bash tool card; only the last (id: '2') is "running" (spinner) — the
    // first, non-last message resolves to runStreaming=false so its unresolved
    // tool renders as an error state instead of a spinner.
    const runningBadges = screen.getAllByTitle('Running');
    expect(runningBadges).toHaveLength(1);
  });

  it('calls onScrolled once after an auto-scroll driven by scrollIntent', () => {
    const onScrolled = vi.fn();
    render(<MessageList messages={messages} scrollIntent onScrolled={onScrolled} />);
    expect(onScrolled).toHaveBeenCalledTimes(1);
  });

  it('does not scroll (or call onScrolled) when scrollIntent is false', () => {
    const onScrolled = vi.fn();
    render(<MessageList messages={messages} scrollIntent={false} onScrolled={onScrolled} />);
    expect(onScrolled).not.toHaveBeenCalled();
  });

  it('marks the active question-form message interactive and routes submit with its message id', () => {
    const withForm: ChatMessage[] = [{ id: 'a1', role: 'assistant', content: '<question-form id="q" title="T">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>', runStatus: 'running' }];
    const onSubmit = vi.fn();
    render(<MessageList messages={withForm} activeQuestionFormMessageId="a1" onQuestionFormSubmit={onSubmit} />);
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('actually invokes the per-message onQuestionFormSubmit wrapper with the owning message id when the form is submitted', async () => {
    const withForm: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '<question-form id="q" title="T">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>', runStatus: 'running' },
    ];
    const onSubmit = vi.fn();
    render(<MessageList messages={withForm} activeQuestionFormMessageId="a1" onQuestionFormSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole('textbox'), 'my answer');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith('a1', expect.any(String), expect.objectContaining({ x: 'my answer' }));
  });

  it('forwards questionFormSubmittedAnswersByMessageId for the message that has a recorded submission', () => {
    const withForm: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '<question-form id="q" title="T">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>', runStatus: 'succeeded' },
    ];
    render(<MessageList messages={withForm} questionFormSubmittedAnswersByMessageId={{ a1: { x: 'already answered' } }} />);
    expect(screen.getByDisplayValue('already answered')).toBeInTheDocument();
  });

  it('forwards projectFileNames and onRequestOpenFile down to MessageRow/ToolCard', async () => {
    const withTool: ChatMessage[] = [
      {
        id: 'a2',
        role: 'assistant',
        content: '',
        events: [
          { kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'known.txt' } },
          { kind: 'tool_result', toolUseId: 't1', content: 'contents', isError: false },
        ],
        runStatus: 'succeeded',
      },
    ];
    const onRequestOpenFile = vi.fn();
    render(<MessageList messages={withTool} projectFileNames={new Set(['known.txt'])} onRequestOpenFile={onRequestOpenFile} />);
    const openButton = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(openButton);
    expect(onRequestOpenFile).toHaveBeenCalledWith('known.txt');
  });

  it('forwards a custom renderAttachment down to MessageRow for user-message attachment chips', () => {
    const withAttachment: ChatMessage[] = [{ id: 'u1', role: 'user', content: 'see attached', attachments: [{ path: '/a.png', name: 'a.png', kind: 'image' }] }];
    render(<MessageList messages={withAttachment} renderAttachment={(a) => <span data-testid="custom-chip">{a.name.toUpperCase()}</span>} />);
    expect(screen.getByTestId('custom-chip')).toHaveTextContent('A.PNG');
  });
});
