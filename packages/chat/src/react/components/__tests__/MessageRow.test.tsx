import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { assistantContentFromEvents } from '../../../core/index.js';
import { clearExtEventRenderers, registerExtEventRenderer } from '../../ext-event-renderer-registry.js';
import {
  __resetAttachmentPreviewCacheForTests,
  cacheAttachmentPreviewSource,
} from '../../hooks/attachment-preview-cache.js';
import { MessageRow } from '../MessageRow.js';
import { registerMidRunUserMessageRenderer } from '../MidRunUserMessage.js';

describe('MessageRow', () => {
  it('renders a user message with its content and attachments', () => {
    const message: ChatMessage = { id: 'u1', role: 'user', content: 'hello there', attachments: [{ path: '/a.png', name: 'a.png', kind: 'image' }] };
    render(<MessageRow message={message} />);
    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(screen.getByText('a.png')).toBeInTheDocument();
  });

  it('renders an assistant message body as markdown', () => {
    const message: ChatMessage = { id: 'a1', role: 'assistant', content: 'some **bold** result', runStatus: 'succeeded' };
    render(<MessageRow message={message} />);
    expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument();
  });

  it('renders a tool timeline for events on the message', () => {
    const message: ChatMessage = {
      id: 'a2',
      role: 'assistant',
      content: 'Let me check.',
      events: [
        { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } },
        { kind: 'tool_result', toolUseId: 't1', content: '/home', isError: false },
      ],
      runStatus: 'succeeded',
    };
    render(<MessageRow message={message} runSucceeded />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('strips a completed <artifact> block from the visible text', () => {
    const message: ChatMessage = { id: 'a3', role: 'assistant', content: 'Here:\n<artifact identifier="x" type="text/html" title="X">\n<h1>hi</h1>\n</artifact>\nDone.', runStatus: 'succeeded' };
    render(<MessageRow message={message} />);
    expect(screen.queryByText('<h1>hi</h1>', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('Here:')).toBeInTheDocument();
    expect(screen.getByText('Done.')).toBeInTheDocument();
  });

  it('renders an inline question-form and forwards submit', async () => {
    const content = 'Quick question:\n<question-form id="q1" title="Pick one">\n{"questions":[{"id":"x","label":"X","type":"radio","options":["A","B"],"required":true}]}\n</question-form>';
    const message: ChatMessage = { id: 'a4', role: 'assistant', content, runStatus: 'succeeded' };
    const onSubmit = vi.fn();
    render(<MessageRow message={message} questionFormInteractive onQuestionFormSubmit={onSubmit} />);
    expect(screen.getByText('Pick one')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows a pending indicator for a running message with no content yet', () => {
    const message: ChatMessage = { id: 'a5', role: 'assistant', content: '', runStatus: 'running' };
    render(<MessageRow message={message} runStreaming />);
    expect(screen.getByText('Thinking… 0 s')).toBeInTheDocument();
  });

  it('keeps a live activity line after the first tool row appears, and drops it once the run ends', () => {
    const events: ChatMessage['events'] = [
      { kind: 'tool_use', id: 't1', name: 'mcp__jini__search_tools', input: {} },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      { kind: 'tool_use', id: 't2', name: 'mcp__jini__execute_delegated_tool', input: { toolId: 'content.post_list' } },
    ];
    const running: ChatMessage = { id: 'a5b', role: 'assistant', content: '', runStatus: 'running', events };
    const { rerender } = render(<MessageRow message={running} runStreaming />);
    expect(screen.getByText('Running Content Post List… 0 s')).toBeInTheDocument();
    rerender(<MessageRow message={{ ...running, runStatus: 'succeeded' }} />);
    expect(screen.queryByText(/Running Content Post List/)).not.toBeInTheDocument();
  });

  it('ticks the activity clock once a second', () => {
    vi.useFakeTimers();
    try {
      const message: ChatMessage = { id: 'a5c', role: 'assistant', content: '', runStatus: 'running' };
      render(<MessageRow message={message} runStreaming />);
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(screen.getByText('Thinking… 3 s')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tags each message for agent inspection, distinctly per role and message id', () => {
    const userMessage: ChatMessage = { id: 'u-9', role: 'user', content: 'hi' };
    const { container: userContainer } = render(<MessageRow message={userMessage} />);
    const userEl = userContainer.querySelector('[data-agent-element="chat-message-u-9"]');
    expect(userEl).toHaveAttribute('data-agent-role', 'region');
    expect(userEl).toHaveAttribute('data-agent-label', 'A message from the user');

    const assistantMessage: ChatMessage = { id: 'a-9', role: 'assistant', content: 'hi back', runStatus: 'succeeded' };
    const { container: assistantContainer } = render(<MessageRow message={assistantMessage} />);
    const assistantEl = assistantContainer.querySelector('[data-agent-element="chat-message-a-9"]');
    expect(assistantEl).toHaveAttribute('data-agent-role', 'region');
    expect(assistantEl).toHaveAttribute('data-agent-label', 'A reply from the assistant');
  });

  it('shows a failure indicator for a failed run', () => {
    const message: ChatMessage = { id: 'a6', role: 'assistant', content: 'partial output', runStatus: 'failed' };
    render(<MessageRow message={message} />);
    expect(screen.getByText('This turn failed.')).toBeInTheDocument();
  });

  it('renders a user message with no attachments (no attachment tray at all)', () => {
    const message: ChatMessage = { id: 'u2', role: 'user', content: 'no attachments here' };
    const { container } = render(<MessageRow message={message} />);
    expect(container.querySelector('.jini-message-attachments')).not.toBeInTheDocument();
  });

  it('uses a custom renderAttachment for a user message attachment chip', () => {
    const message: ChatMessage = { id: 'u3', role: 'user', content: 'see attached', attachments: [{ path: '/a.png', name: 'a.png', kind: 'image' }] };
    render(<MessageRow message={message} renderAttachment={(a) => <span data-testid="custom-chip">{a.name.toUpperCase()}</span>} />);
    expect(screen.getByTestId('custom-chip')).toHaveTextContent('A.PNG');
  });

  describe('attachment chip -> preview modal', () => {
    afterEach(() => __resetAttachmentPreviewCacheForTests());

    it('is inert until clicked, then opens a labeled dialog and restores focus to the chip on close', async () => {
      const message: ChatMessage = {
        id: 'u4',
        role: 'user',
        content: 'see attached',
        attachments: [{ path: 'attachment:u4-1', name: 'ai-caps.avif', kind: 'file' }],
      };
      render(<MessageRow message={message} />);

      const chip = screen.getByRole('button', { name: 'Open ai-caps.avif' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await userEvent.click(chip);
      const dialog = screen.getByRole('dialog', { name: 'ai-caps.avif preview' });
      expect(dialog).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(chip).toHaveFocus();
    });

    it('shows an honest filename/type/size fallback when no bytes were cached for this browser session', async () => {
      const message: ChatMessage = {
        id: 'u5',
        role: 'user',
        content: 'see attached',
        attachments: [{ path: 'attachment:u5-1', name: 'report.pdf', kind: 'file', size: 2048 }],
      };
      render(<MessageRow message={message} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open report.pdf' }));

      expect(screen.getByText('A preview is not available for this file.')).toBeInTheDocument();
      expect(screen.getByText('2 KB')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('shows cached text content for a text-ish attachment', async () => {
      cacheAttachmentPreviewSource({ path: 'attachment:u6-1', file: new File(['{"ok":true}'], 'data.json') });
      const message: ChatMessage = {
        id: 'u6',
        role: 'user',
        content: 'see attached',
        attachments: [{ path: 'attachment:u6-1', name: 'data.json', kind: 'file' }],
      };
      render(<MessageRow message={message} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open data.json' }));

      expect(await screen.findByText('{"ok":true}')).toBeInTheDocument();
    });

    it('closes on the dialog\'s native cancel event (Escape, in a real browser) without leaving it open', async () => {
      const message: ChatMessage = {
        id: 'u7',
        role: 'user',
        content: 'see attached',
        attachments: [{ path: 'attachment:u7-1', name: 'notes.txt', kind: 'file' }],
      };
      const { container } = render(<MessageRow message={message} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open notes.txt' }));
      const dialog = container.querySelector('dialog.jini-attachment-preview-dialog')!;
      expect(dialog.hasAttribute('open')).toBe(true);

      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      expect(dialog.hasAttribute('open')).toBe(false);
    });

    it('closes on a backdrop click but not on a click inside the dialog surface', async () => {
      const message: ChatMessage = {
        id: 'u8',
        role: 'user',
        content: 'see attached',
        attachments: [{ path: 'attachment:u8-1', name: 'notes.txt', kind: 'file' }],
      };
      const { container } = render(<MessageRow message={message} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open notes.txt' }));
      const dialog = container.querySelector('dialog.jini-attachment-preview-dialog')!;

      fireEvent.click(screen.getByText('notes.txt', { selector: '.jini-attachment-preview-name' }));
      expect(dialog.hasAttribute('open')).toBe(true);

      fireEvent.click(dialog);
      expect(dialog.hasAttribute('open')).toBe(false);
    });
  });

  it('renders the agent name badge when the message has one', () => {
    const message: ChatMessage = { id: 'a7', role: 'assistant', content: 'hi', agentName: 'Researcher', runStatus: 'succeeded' };
    render(<MessageRow message={message} />);
    expect(screen.getByText('Researcher')).toBeInTheDocument();
  });

  it('skips an empty/whitespace-only text segment between a leading question-form and following content', () => {
    const content = '<question-form id="q1" title="Pick">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>\n   \n';
    const message: ChatMessage = { id: 'a8', role: 'assistant', content, runStatus: 'succeeded' };
    const { container } = render(<MessageRow message={message} />);
    // Only the question-form segment renders content; the trailing whitespace-only
    // text segment must not produce an empty `.jini-message-content` div.
    expect(container.querySelectorAll('.jini-message-content')).toHaveLength(0);
    expect(screen.getByText('Pick')).toBeInTheDocument();
  });

  it('renders submittedAnswers (locked, read-only) on the inline question-form when provided', () => {
    const content = '<question-form id="q2" title="Done already">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>';
    const message: ChatMessage = { id: 'a9', role: 'assistant', content, runStatus: 'succeeded' };
    render(<MessageRow message={message} questionFormSubmittedAnswers={{ x: 'locked answer' }} />);
    expect(screen.getByDisplayValue('locked answer')).toBeInTheDocument();
    expect(screen.getByText('You answered this')).toBeInTheDocument();
  });

  it('renders an inline question-form with no onQuestionFormSubmit wired (footer button hidden)', () => {
    const content = '<question-form id="q3" title="No handler">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>';
    const message: ChatMessage = { id: 'a10', role: 'assistant', content, runStatus: 'succeeded' };
    render(<MessageRow message={message} questionFormInteractive />);
    expect(screen.getByText('No handler')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('forwards projectFileNames/onRequestOpenFile to the tool timeline', async () => {
    const message: ChatMessage = {
      id: 'a11',
      role: 'assistant',
      content: '',
      events: [
        { kind: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'known.txt' } },
        { kind: 'tool_result', toolUseId: 't2', content: 'contents', isError: false },
      ],
      runStatus: 'succeeded',
    };
    const onRequestOpenFile = vi.fn();
    render(<MessageRow message={message} runSucceeded projectFileNames={new Set(['known.txt'])} onRequestOpenFile={onRequestOpenFile} />);
    // A collapsed tool card mounts no panel, so the "Open" file button only exists once it is opened.
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onRequestOpenFile).toHaveBeenCalledWith('known.txt');
  });

  describe('usage summary line', () => {
    afterEach(() => clearExtEventRenderers());

    const midRun = (id: string): AgentEvent => ({ kind: 'ext', name: 'user_message', data: { id, text: `prompt ${id}` } });
    const reply = (id: string, events: AgentEvent[], runStatus: NonNullable<ChatMessage['runStatus']>): ChatMessage =>
      ({ id, role: 'assistant', content: assistantContentFromEvents({ events }), runStatus, events });

    it.each([
      { runStatus: 'succeeded' as const, notice: undefined, label: 'Done', dot: true },
      { runStatus: 'failed' as const, notice: 'Agent failed', label: 'Failed', dot: false },
      { runStatus: 'canceled' as const, notice: 'Run canceled', label: 'Canceled', dot: false },
      { runStatus: 'canceled' as const, notice: 'Stopped. Saved work is above.', label: 'Stopped', dot: false },
    ])('labels the final footer from the $runStatus run outcome ($label)', ({ runStatus, notice, label, dot }) => {
      const events: AgentEvent[] = [
        { kind: 'text', text: 'First reply.' }, { kind: 'usage', costUsd: 0.1 }, midRun('followup'),
        { kind: 'text', text: 'Final reply.' }, { kind: 'usage', outputTokens: 1040, costUsd: 0.2 },
        ...(notice ? [{ kind: 'status' as const, code: 'run_terminal', label: notice }] : []),
      ];
      render(<MessageRow message={reply('end-state', events, runStatus)} />);
      const footer = [...document.querySelectorAll('.jini-message-usage')].at(-1)!;
      expect(footer.textContent).toContain(`${label} · $0.20`);
      expect(footer).toHaveAttribute('aria-label', `${label} · $0.20 · total $0.30 · 1,040 output tokens`);
      expect(footer.querySelector('.jini-message-usage-dot') !== null).toBe(dot);
      expect(screen.getByText('Final reply.').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps late stopped-reply usage above a trailing mid-run input with no assistant reply', () => {
      registerMidRunUserMessageRenderer();
      render(<MessageRow message={reply('trailing-input', [
        { kind: 'text', text: 'Saved work.' }, midRun('unanswered'),
        { kind: 'usage', costUsd: 0.25, stopReason: 'aborted_streaming' },
        { kind: 'status', code: 'run_terminal', label: 'Stopped. Saved work is above.' },
      ], 'canceled')} />);
      const footer = document.querySelector('.jini-message-usage')!;
      expect(footer).toHaveTextContent('Stopped · $0.25');
      expect(footer.querySelector('.jini-message-usage-dot')).toBeNull();
      expect(footer.compareDocumentPosition(screen.getByText('prompt unanswered')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it.each(['max_tokens', 'aborted_streaming'])('does not label a %s reply Done when its run exited successfully', stopReason => {
      const view = render(<MessageRow message={reply('cut-off', [
        { kind: 'text', text: 'Let me survey the CSS' }, { kind: 'usage', costUsd: 0.1, stopReason },
      ], 'succeeded')} />);
      expect(view.container.querySelector('.jini-message-usage')).toHaveTextContent('Interrupted · $0.10');
      expect(view.container.querySelector('.jini-message-usage-dot')).toBeNull();
    });

    it('labels a reply ending on an unanswered surface as waiting', () => {
      render(<MessageRow message={reply('waiting', [
        { kind: 'text', text: 'Choose a theme.' }, { kind: 'usage', costUsd: 0.1 },
        { kind: 'tool_use', id: 'q', name: 'assistant_ask_choice', input: { question: 'Which theme?' } },
        { kind: 'ext', name: 'mcp-ui', data: {} },
      ], 'succeeded')} />);
      expect(document.querySelector('.jini-message-usage')).toHaveTextContent('Waiting for your answer · $0.10');
      expect(document.querySelector('.jini-message-usage-dot')).toBeNull();
    });

    it('gives each finished mid-run reply its own Done line where that reply ends, with the running total as of that reply', () => {
      registerMidRunUserMessageRenderer();
      render(<MessageRow message={reply('replies', [
        { kind: 'text', text: 'First answer.' },
        { kind: 'usage', inputTokens: 100, outputTokens: 995, costUsd: 0.03, durationMs: 13_000 },
        midRun('u2'),
        { kind: 'text', text: 'Second answer.' },
        { kind: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.0198, durationMs: 1_000 },
      ], 'succeeded')} />);
      const lines = [...document.querySelectorAll('.jini-message-usage')];
      expect(lines.map((line) => line.textContent)).toEqual(['●Done · 13s · $0.03 · total $0.03', '●Done · 1s · $0.02 · total $0.05']);
      expect(lines.map((line) => line.getAttribute('title'))).toEqual(['995 output tokens', '5 output tokens']);
      expect(screen.getByRole('note', { name: 'Done · 13s · $0.03 · total $0.03 · 995 output tokens' })).toBeInTheDocument();
      const bubble = screen.getByText('prompt u2');
      expect(lines[0]!.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(bubble.compareDocumentPosition(lines[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows no Done line for the reply still running, only for the finished replies before it', () => {
      registerMidRunUserMessageRenderer();
      render(<MessageRow runStreaming message={reply('running', [
        { kind: 'text', text: 'First answer.' },
        { kind: 'usage', costUsd: 0.03 },
        midRun('u2'),
        { kind: 'text', text: 'Second answer.' },
        { kind: 'usage', costUsd: 0.02 },
        midRun('u3'),
        { kind: 'text', text: 'Still working on the third.' },
      ], 'running')} />);
      const lines = [...document.querySelectorAll('.jini-message-usage')];
      expect(lines.map((line) => line.textContent)).toEqual(['●Done · $0.03 · total $0.03', '●Done · $0.02 · total $0.05']);
      expect(lines[1]!.compareDocumentPosition(screen.getByText('prompt u3')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('holds a running turn\'s interim usage until the turn finishes', () => {
      const events: AgentEvent[] = [{ kind: 'usage', costUsd: 0.5 }, { kind: 'text', text: 'still going' }];
      const view = render(<MessageRow runStreaming message={reply('interim', events, 'running')} />);
      expect(document.querySelector('.jini-message-usage')).toBeNull();
      view.rerender(<MessageRow message={reply('interim', events, 'succeeded')} />);
      expect(document.querySelector('.jini-message-usage')?.textContent).toBe('●Done · $0.50 · total $0.50');
    });

    it('leaves the running total off only when showUsageTotal is false', () => {
      render(<MessageRow showUsageTotal={false} message={reply('total', [{ kind: 'usage', costUsd: 0.05 }], 'succeeded')} />);
      expect(document.querySelector('.jini-message-usage')?.textContent).toBe('●Done · $0.05');
    });

    it('keeps each finished reply\'s Done line under that reply while a mid-run reply runs its tools', () => {
      registerMidRunUserMessageRenderer();
      render(<MessageRow runStreaming message={reply('live-tools', [
        { kind: 'text', text: 'First answer.' },
        { kind: 'usage', costUsd: 0.39, durationMs: 16_000 },
        midRun('u2'),
        { kind: 'text', text: 'Second answer.' },
        { kind: 'usage', costUsd: 3.56, durationMs: 3_000 },
        midRun('u3'),
        { kind: 'text', text: 'Checking.' },
        { kind: 'tool_use', id: 'live', name: 'Bash', input: { command: 'ls' } },
      ], 'running')} />);
      const lines = [...document.querySelectorAll('.jini-message-usage')];
      expect(lines.map((line) => line.textContent)).toEqual(['●Done · 16s · $0.39 · total $0.39', '●Done · 3s · $3.56 · total $3.95']);
      expect(lines[0]!.compareDocumentPosition(screen.getByText('prompt u2')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(lines[1]!.compareDocumentPosition(screen.getByText('prompt u3')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const liveTools = [...document.querySelectorAll('.jini-message-tools')].at(-1)!;
      expect(liveTools.textContent).toContain('Bash');
      for (const line of lines) expect(line.compareDocumentPosition(liveTools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows no Done line on a streaming row whose runStatus was never set', () => {
      const message: ChatMessage = { id: 'no-status', role: 'assistant', content: 'still going',
        events: [{ kind: 'usage', costUsd: 0.5 }, { kind: 'text', text: 'still going' }] };
      const view = render(<MessageRow runStreaming message={message} />);
      expect(document.querySelector('.jini-message-usage')).toBeNull();
      view.rerender(<MessageRow message={message} />);
      expect(document.querySelector('.jini-message-usage')?.textContent).toBe('●Done · $0.50 · total $0.50');
    });

    it('renders duration and upward-rounded cost, with output tokens in the tooltip', () => {
      const message: ChatMessage = {
        id: 'u1',
        role: 'assistant',
        content: 'Done.',
        events: [{ kind: 'usage', inputTokens: 26, outputTokens: 2612, costUsd: 0.4028355, durationMs: 46220 }],
        runStatus: 'succeeded',
      };
      render(<MessageRow message={message} runSucceeded />);
      const usageText = document.querySelector('.jini-message-usage')?.textContent;
      expect(usageText).toContain('Done');
      expect(usageText).toContain('46s');
      expect(usageText).not.toContain('2,612 output tokens');
      expect(screen.getByRole('note', { name: 'Done · 46s · $0.41 · total $0.41 · 2,612 output tokens' })).toBeInTheDocument();
      expect(document.querySelector('.jini-message-usage')).toHaveAttribute('title', '2,612 output tokens');
      expect(usageText).toContain('$0.41 · total $0.41');
    });

    it('formats a duration over a minute as "Xm Ys"', () => {
      const message: ChatMessage = {
        id: 'u2',
        role: 'assistant',
        content: '',
        events: [{ kind: 'usage', durationMs: 389000 }],
        runStatus: 'succeeded',
      };
      render(<MessageRow message={message} runSucceeded />);
      expect(screen.getByText(/6m 29s/)).toBeInTheDocument();
    });

    it('renders only the fields the usage event actually carries, never a fabricated zero', () => {
      const message: ChatMessage = {
        id: 'u3',
        role: 'assistant',
        content: '',
        events: [{ kind: 'usage', costUsd: 0.01 }],
        runStatus: 'succeeded',
      };
      render(<MessageRow message={message} runSucceeded />);
      expect(screen.getByText(/\$0\.01$/)).toBeInTheDocument();
      expect(screen.queryByText(/out/)).not.toBeInTheDocument();
    });

    it('renders nothing when the usage event carries no displayable field', () => {
      const message: ChatMessage = { id: 'u4', role: 'assistant', content: 'hi', events: [{ kind: 'usage' }], runStatus: 'succeeded' };
      render(<MessageRow message={message} runSucceeded />);
      expect(document.querySelector('.jini-message-usage')).toBeNull();
    });

    it('renders nothing when there is no usage event at all', () => {
      const message: ChatMessage = { id: 'u5', role: 'assistant', content: 'hi', runStatus: 'succeeded' };
      render(<MessageRow message={message} runSucceeded />);
      expect(document.querySelector('.jini-message-usage')).toBeNull();
    });

    it('sums costs from every usage event when more than one is present', () => {
      const message: ChatMessage = {
        id: 'u6',
        role: 'assistant',
        content: '',
        events: [
          { kind: 'usage', costUsd: 0.01 },
          { kind: 'usage', costUsd: 0.99 },
        ],
        runStatus: 'succeeded',
      };
      render(<MessageRow message={message} runSucceeded />);
      expect(document.querySelector('.jini-message-usage')?.textContent).toBe('●Done · $1.00 · total $1.00');
    });
  });

  describe('ext events', () => {
    afterEach(() => clearExtEventRenderers());

    it('dispatches a kind:ext event group to its registered renderer, passing every event and runId', () => {
      const seen: unknown[] = [];
      registerExtEventRenderer({ name: 'a2ui', renderer: (props) => {
        seen.push(props);
        return <div data-testid="a2ui-rendered">{props.events.length} events</div>;
      } });
      const message: ChatMessage = {
        id: 'e1',
        role: 'assistant',
        content: '',
        runId: 'run-123',
        events: [
          { kind: 'ext', name: 'a2ui', data: { step: 1 } },
          { kind: 'ext', name: 'a2ui', data: { step: 2 } },
        ],
        runStatus: 'running',
      };
      render(<MessageRow message={message} runStreaming runSucceeded={false} />);
      expect(screen.getByTestId('a2ui-rendered')).toHaveTextContent('2 events');
      expect(seen).toEqual([
        { name: 'a2ui', events: [{ step: 1 }, { step: 2 }], runStreaming: true, runSucceeded: false, awaitingAnswer: false, runId: 'run-123', answered: false, onAnswered: expect.any(Function), onAnswerText: expect.any(Function) },
      ]);
    });

    // Owner, 2026-10-11: after Confirm on a "Confirm action?" card the card read "Done." but the line
    // under it kept saying "Waiting for your answer above" (and the card kept counting down) until
    // the confirmed publish finished, because the tool call stays open while that work runs.
    it('stops saying Waiting for your answer the moment the card reports its answer delivered', () => {
      const answeredSeen: boolean[] = [];
      registerExtEventRenderer({ name: 'mcp-ui', renderer: (props) => {
        answeredSeen.push(props.answered === true);
        return <button type="button" onClick={props.onAnswered}>Confirm</button>;
      } });
      const message: ChatMessage = {
        id: 'confirm-1',
        role: 'assistant',
        content: '',
        runId: 'r',
        events: [
          { kind: 'tool_use', id: 't1', name: 'deployment_execute_static_publish', input: {} },
          { kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://confirm' } },
        ],
        runStatus: 'running',
      };
      render(<MessageRow message={message} runStreaming runSucceeded={false} />);
      expect(document.querySelector('.jini-run-activity')?.textContent).toBe('Waiting for your answer above');

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(document.querySelector('.jini-run-activity')?.textContent).toMatch(/^Running Deployment Execute Static Publish… \d+ s$/);
      expect(answeredSeen[0]).toBe(false);
      expect(answeredSeen[answeredSeen.length - 1]).toBe(true);
    });

    // Demo dry-run 2026-10-05: a "still working" notice rendered under an open credential form, so
    // a run waiting on the person looked hung. Renderers learn the run is waiting on the person.
    it('tells ext renderers the run is awaiting an answer while a card sits on an open tool call', () => {
      const seen: boolean[] = [];
      registerExtEventRenderer({ name: 'slow_running', renderer: (props) => {
        seen.push(props.awaitingAnswer === true);
        return null;
      } });
      const events: ChatMessage['events'] = [
        { kind: 'tool_use', id: 't1', name: 'source_control_propose_credential', input: {} },
        { kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://form' } },
        { kind: 'ext', name: 'slow_running', data: { type: 'slow_running' } },
      ];
      const message: ChatMessage = { id: 'w1', role: 'assistant', content: '', runId: 'r', events, runStatus: 'running' };
      const { rerender } = render(<MessageRow message={message} runStreaming runSucceeded={false} />);
      const answered: ChatMessage = { ...message, events: [...events, { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false }] };
      rerender(<MessageRow message={answered} runStreaming runSucceeded={false} />);
      expect(seen[0]).toBe(true);
      expect(seen[seen.length - 1]).toBe(false);
    });

    // host stuck-chat investigation, 2026-09-27: the second choice card of a run rendered inside
    // the FIRST surface's slot, far above the spinning tool row, so nobody could answer it.
    it('renders a keyed surface at its own position and hands each slot only its own events', () => {
      const seen: unknown[][] = [];
      registerExtEventRenderer({ name: 'mcp-ui', renderer: (props) => {
          seen.push([...props.events]);
          const uris = props.events.map((e) => (e as { uri: string }).uri).join(',');
          return <div data-testid={`surface ${uris}`}>{uris}</div>;
        } }, { slotKey: ({ data }) => typeof data === 'object' && data !== null && 'uri' in data && typeof data.uri === 'string' ? data.uri : undefined });
      const message: ChatMessage = {
        id: 'e-slots',
        role: 'assistant',
        content: 'Connected. Making one.',
        runId: 'run-9',
        events: [
          { kind: 'tool_use', id: 't1', name: 'connect', input: {} },
          { kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://connect' } },
          { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
          { kind: 'text', text: 'Connected. ' },
          { kind: 'text', text: 'Making one.' },
          { kind: 'tool_use', id: 't2', name: 'ask', input: {} },
          { kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://choice-2' } },
        ],
        runStatus: 'running',
      };
      render(<MessageRow message={message} runStreaming runSucceeded={false} />);

      const first = screen.getByTestId('surface ui://connect');
      const second = screen.getByTestId('surface ui://choice-2');
      const narration = screen.getByText('Connected. Making one.');
      expect(first.compareDocumentPosition(narration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(narration.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(seen).toEqual([[{ uri: 'ui://connect' }], [{ uri: 'ui://choice-2' }]]);
    });

    it('renders nothing for an ext event whose name has no registered renderer', () => {
      const message: ChatMessage = {
        id: 'e2',
        role: 'assistant',
        content: 'hi',
        events: [{ kind: 'ext', name: 'unregistered_kind', data: {} }],
        runStatus: 'succeeded',
      };
      render(<MessageRow message={message} runSucceeded />);
      expect(document.querySelector('.jini-message-ext-events')?.textContent).toBe('');
    });

    it('renders nothing when the registered renderer itself returns null/false/undefined', () => {
      registerExtEventRenderer({ name: 'quiet', renderer: () => null });
      const message: ChatMessage = {
        id: 'e3',
        role: 'assistant',
        content: '',
        events: [{ kind: 'ext', name: 'quiet', data: {} }],
        runStatus: 'succeeded',
      };
      render(<MessageRow message={message} runSucceeded />);
      expect(document.querySelector('.jini-message-ext-events')?.textContent).toBe('');
    });

    it('confines a throwing ext-event renderer to its own group instead of crashing the whole row', () => {
      // Registered the same way a real hooks-based renderer is (`(props) => <SomeComponent ... />`,
      // per this registry's own module doc) so the throw happens during React's reconciliation of
      // the returned element — same place a real render-phase or effect-phase throw from e.g.
      // `A2uiSurfaceCard` would land — not synchronously inside `MessageRow`'s own render body.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      function ThrowingRenderer(): never {
        throw new Error('malformed data-model path');
      }
      registerExtEventRenderer({ name: 'a2ui', renderer: () => <ThrowingRenderer /> });
      const message: ChatMessage = {
        id: 'e4',
        role: 'assistant',
        content: 'still here',
        events: [{ kind: 'ext', name: 'a2ui', data: {} }],
        runStatus: 'succeeded',
      };
      render(<MessageRow message={message} runSucceeded />);
      expect(screen.getByText('still here')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('"a2ui" failed to render: malformed data-model path');
      consoleError.mockRestore();
    });
  });

  describe('per-message copy button', () => {
    // jsdom does not implement the Clipboard API, so each test that exercises the primary
    // (secure-context) path installs its own `navigator.clipboard` stub and removes it afterward
    // — a real secure-context host is exactly what this stub stands in for.
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
      vi.restoreAllMocks();
    });

    it('copies a user message’s raw content, right-aligned to match the bubble', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const message: ChatMessage = { id: 'u1', role: 'user', content: 'hello there' };
      const { container } = render(<MessageRow message={message} />);

      const row = container.querySelector('.jini-message-actions--user');
      expect(row).toBeInTheDocument();
      const button = screen.getByRole('button', { name: 'Copy message' });
      expect(row).toContainElement(button);

      await userEvent.click(button);
      expect(writeText).toHaveBeenCalledWith('hello there');
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
      expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
    });

    it('copies the raw markdown source of an assistant message, not its rendered/flattened text', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const markdown = 'Here is **bold** and a fence:\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |';
      const message: ChatMessage = { id: 'a1', role: 'assistant', content: markdown, runStatus: 'succeeded' };
      render(<MessageRow message={message} runSucceeded />);

      // Sanity check: the DOM only ever holds the rendered/flattened form (a real <strong>, a
      // <table>, no visible '**' or '|'), so a naive innerText/textContent read of the message
      // would already have lost the markdown syntax this test asserts survives the copy.
      expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.queryByText('**bold**', { exact: false })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Copy message' }));
      expect(writeText).toHaveBeenCalledWith(markdown);
    });

    it('copies the visible text with a stripped <artifact> block excluded, matching what the message actually renders', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const content = 'Here:\n<artifact identifier="x" type="text/html" title="X">\n<h1>hi</h1>\n</artifact>\nDone.';
      const message: ChatMessage = { id: 'a3', role: 'assistant', content, runStatus: 'succeeded' };
      render(<MessageRow message={message} runSucceeded />);

      await userEvent.click(screen.getByRole('button', { name: 'Copy message' }));
      const [copied] = writeText.mock.calls[0] as [string];
      expect(copied).not.toContain('<artifact');
      expect(copied).toContain('Here:');
      expect(copied).toContain('Done.');
    });

    it('falls back to the execCommand path when the Clipboard API is unavailable (non-secure context)', async () => {
      const execCommand = vi.fn().mockReturnValue(true);
      // navigator.clipboard is left undefined by jsdom by default — this stands in for any host
      // served over plain HTTP, where `navigator.clipboard` does not exist at all.
      document.execCommand = execCommand;
      const message: ChatMessage = { id: 'u2', role: 'user', content: 'plain http copy' };
      render(<MessageRow message={message} />);

      await userEvent.click(screen.getByRole('button', { name: 'Copy message' }));
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('does not render an action row while a message is still pending with no content', () => {
      const message: ChatMessage = { id: 'a5', role: 'assistant', content: '', runStatus: 'running' };
      const { container } = render(<MessageRow message={message} runStreaming />);
      expect(container.querySelector('.jini-message-actions')).not.toBeInTheDocument();
    });

    it('withholds the copy button while a run is still in progress, even once text has settled and a tool row has already streamed in', () => {
      // The actual reported symptom: text and a completed tool row are already on screen, but the
      // run itself (`runStatus`) has not reached a terminal status yet — e.g. a trailing tool call
      // is still in flight. `isPendingWithNoContent` alone would call this "not pending" (it has
      // content), so the copy button must not key off that predicate by itself.
      const message: ChatMessage = {
        id: 'a12',
        role: 'assistant',
        content: "I'll check that.",
        events: [
          { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } },
          { kind: 'tool_result', toolUseId: 't1', content: '/home', isError: false },
          { kind: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'x.txt' } },
        ],
        runStatus: 'running',
      };
      const { container } = render(<MessageRow message={message} runStreaming />);
      expect(screen.getByText("I'll check that.")).toBeInTheDocument();
      expect(screen.getByText('Bash')).toBeInTheDocument();
      expect(container.querySelector('.jini-message-actions')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument();
    });

    it('shows the copy button once a run completes normally', () => {
      const message: ChatMessage = { id: 'a13', role: 'assistant', content: 'All done.', runStatus: 'succeeded' };
      render(<MessageRow message={message} runSucceeded />);
      expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    });

    it('shows the copy button once a run ends in an error, so the partial output stays copyable', () => {
      const message: ChatMessage = { id: 'a14', role: 'assistant', content: 'partial output', runStatus: 'failed' };
      render(<MessageRow message={message} />);
      expect(screen.getByText('This turn failed.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    });

    it('shows the copy button once a run is cancelled/stopped', () => {
      const message: ChatMessage = { id: 'a15', role: 'assistant', content: 'stopped early', runStatus: 'canceled' };
      render(<MessageRow message={message} />);
      expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    });
  });

  describe('interleaved edge cases', () => {
    afterEach(() => clearExtEventRenderers());

    it('renders a question form that sits inside an interleaved text block', () => {
      const form = '<question-form id="q1" title="Pick one">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>';
      const events: AgentEvent[] = [
        { kind: 'text', text: `Before.\n${form}\n   ` },
        { kind: 'tool_use', id: 't1', name: 'alpha', input: {} },
        { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      ];
      render(<MessageRow message={{ id: 'qi', role: 'assistant', content: assistantContentFromEvents({ events }), runStatus: 'succeeded', events }} />);
      expect(screen.getByText('Pick one')).toBeInTheDocument();
      expect(document.querySelectorAll('.jini-message-content')).toHaveLength(1);
      expect(screen.getByText('Before.')).toBeInTheDocument();
    });

    const interleavedForm = (): ChatMessage => {
      const form = '<question-form id="q1" title="Pick one">\n{"questions":[{"id":"x","label":"X","type":"text"}]}\n</question-form>';
      const events: AgentEvent[] = [
        { kind: 'text', text: form },
        { kind: 'tool_use', id: 't1', name: 'alpha', input: {} },
        { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      ];
      return { id: 'qs', role: 'assistant', content: assistantContentFromEvents({ events }), runStatus: 'succeeded', events };
    };

    it('shows submitted answers on a question form in an interleaved text block', () => {
      render(<MessageRow message={interleavedForm()} questionFormSubmittedAnswers={{ x: 'locked answer' }} />);
      expect(screen.getByDisplayValue('locked answer')).toBeInTheDocument();
    });

    it('forwards the submit handler to a question form in an interleaved text block', async () => {
      const onSubmit = vi.fn();
      render(<MessageRow message={interleavedForm()} questionFormInteractive onQuestionFormSubmit={onSubmit} />);
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('renders no thinking fold for whitespace-only reasoning', () => {
      const events: AgentEvent[] = [
        { kind: 'thinking', text: '   ' },
        { kind: 'tool_use', id: 't1', name: 'alpha', input: {} },
        { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
        { kind: 'text', text: 'Answer.' },
      ];
      render(<MessageRow message={{ id: 'th', role: 'assistant', content: 'Answer.', runStatus: 'succeeded', events }} showThinking />);
      expect(document.querySelector('details.jini-message-thinking')).toBeNull();
    });

    it('drops an ext block whose slot no longer matches any event group (unstable host slot key)', () => {
      let calls = 0;
      registerExtEventRenderer({ name: 'flaky', renderer: () => <div data-testid="flaky">x</div> }, { slotKey: () => `slot-${calls++}` });
      const events: AgentEvent[] = [{ kind: 'text', text: 'Hi.' }, { kind: 'ext', name: 'flaky', data: {} }];
      render(<MessageRow message={{ id: 'fl', role: 'assistant', content: 'Hi.', runStatus: 'succeeded', events }} />);
      expect(screen.queryByTestId('flaky')).toBeNull();
      expect(document.querySelector('.jini-message-ext-events')).toBeNull();
    });

    it('shows no activity line for a running reply that is not streaming and already has content', () => {
      render(<MessageRow message={{ id: 'ra', role: 'assistant', content: 'Partial.', runStatus: 'running', events: [{ kind: 'text', text: 'Partial.' }] }} />);
      expect(document.querySelector('.jini-run-activity')).toBeNull();
    });
  });
});
