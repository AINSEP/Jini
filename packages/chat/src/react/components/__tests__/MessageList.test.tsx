import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('does not yank the view back down when a new scrollIntent event (e.g. a streaming tool-call chunk) arrives while the user has scrolled up to read history', () => {
    // Reproduces the owner-reported bug: "whenever it's on and the chat's going, and I'm scrolling
    // up to try to find messages, whenever a new line comes in — like 'searching tools' — it forces
    // me to the bottom." Every streaming event re-fires `useConversation`'s `applyRunToAssistantMessage`,
    // which sets `scrollIntent: true` unconditionally — this component must still refuse to move the
    // scroll position unless the user was actually pinned to the bottom when that event arrived.
    const onScrolled = vi.fn();
    const { container, rerender } = render(<MessageList messages={messages} scrollIntent={false} onScrolled={onScrolled} />);
    const el = container.querySelector('.jini-message-list') as HTMLDivElement;

    // A genuinely overflowing container (clientHeight < scrollHeight), so "scrolled to 0" is
    // distinguishable from "at the bottom".
    Object.defineProperty(el, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });

    // The user scrolls up to read earlier history.
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));

    // A new streaming chunk lands: `messages` changes identity and `scrollIntent` flips true again,
    // exactly like a live tool-call status update reconciling onto the streaming assistant message.
    const streamedMessages: ChatMessage[] = [...messages, { id: '3', role: 'assistant', content: 'searching tools…', runStatus: 'running' }];
    rerender(<MessageList messages={streamedMessages} scrollIntent onScrolled={onScrolled} />);

    expect(el.scrollTop).toBe(0);
  });

  describe('re-sticking to the bottom when a message ROW grows after mount', () => {
    // Reproduces the MCP-UI clipping bug: a confirmation surface mounts small (its
    // `preferredFrameSize`/`DEFAULT_INITIAL_HEIGHT` guess), the one-shot `scrollIntent` effect scrolls
    // to that (small) bottom, and only THEN does the surface report its real, taller content height
    // asynchronously via `ui/notifications/size-changed` — entirely inside `McpUiHost`'s own state,
    // with no accompanying `messages` change to re-trigger the effect above. Without a second,
    // content-size-driven scroll mechanism, the surface's action buttons (or the assistant's next
    // reply) end up below the stale "bottom" with nothing to bring them into view.
    const originalResizeObserver = globalThis.ResizeObserver;

    afterEach(() => {
      globalThis.ResizeObserver = originalResizeObserver;
    });

    function installFakeResizeObserver(): () => void {
      const callbacks: Array<() => void> = [];
      class FakeResizeObserver {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe() {}
        disconnect() {}
      }
      globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
      return () => {
        for (const cb of callbacks) cb();
      };
    }

    it('scrolls to the new bottom when a message row grows with no messages change, if the transcript was at the bottom', () => {
      const fireResize = installFakeResizeObserver();
      const { container } = render(<MessageList messages={messages} scrollIntent onScrolled={() => {}} />);
      const el = container.querySelector('.jini-message-list') as HTMLDivElement;

      // The one-shot scrollIntent effect already ran against the transcript's ORIGINAL height.
      // `clientHeight` smaller than `scrollHeight` — a genuinely overflowing, scrollable container.
      Object.defineProperty(el, 'scrollHeight', { value: 300, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
      el.scrollTop = 200;

      // A message row (e.g. one hosting an McpUiHost iframe) grows well after mount — no `messages`
      // prop change accompanies it, exactly as `McpUiHost`'s async size report behaves.
      Object.defineProperty(el, 'scrollHeight', { value: 600, configurable: true });
      fireResize();

      expect(el.scrollTop).toBe(600);
    });

    it('does NOT yank the view back down when the user had scrolled up to read history', () => {
      const fireResize = installFakeResizeObserver();
      const { container } = render(<MessageList messages={messages} scrollIntent onScrolled={() => {}} />);
      const el = container.querySelector('.jini-message-list') as HTMLDivElement;

      // `clientHeight` deliberately smaller than `scrollHeight` — an actually-overflowing
      // container, so scrolling to 0 is genuinely distinguishable from "at the bottom" (with no
      // overflow at all, top and bottom are the same position and this test would prove nothing).
      Object.defineProperty(el, 'scrollHeight', { value: 300, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
      el.scrollTop = 200;

      // The user scrolls away from the bottom to read earlier history.
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));

      // Some unrelated row grows.
      Object.defineProperty(el, 'scrollHeight', { value: 600, configurable: true });
      fireResize();

      expect(el.scrollTop).toBe(0);
    });
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

  describe('pendingPrompt', () => {
    // Regression coverage for the queued-turn strip's move from a banner bolted above the
    // composer (ChatPane's old `ChatPaneQueuedPrompt`) into the transcript itself, as the newest
    // entry — matching Claude Code/ChatGPT's own pending-turn UX.
    it('renders nothing when nothing is queued', () => {
      render(<MessageList messages={messages} pendingPrompt={null} />);
      expect(screen.queryByTestId('chat-pane-queued')).not.toBeInTheDocument();
    });

    it('renders the queued text as the newest transcript entry, after every real message', () => {
      const { container } = render(<MessageList messages={messages} pendingPrompt={{ text: 'third turn', onCancel: () => {} }} />);
      const el = container.querySelector('.jini-message-list') as HTMLDivElement;
      expect(el.lastElementChild).toHaveAttribute('data-testid', 'chat-pane-queued');
      expect(screen.getByText('third turn')).toBeInTheDocument();
    });

    it('invokes onCancel from the transcript entry\'s own cancel affordance', async () => {
      const onCancel = vi.fn();
      render(<MessageList messages={messages} pendingPrompt={{ text: 'third turn', onCancel }} />);
      await userEvent.click(screen.getByTitle('Cancel queued message'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('never mints a message id or writes the pending turn into the messages array it was given', () => {
      // `pendingPrompt` is pane-local queue state, not a `ChatMessage` — asserting there is no
      // `data-message-id` on the queued row (unlike every real MessageRow) is what actually proves
      // it never got treated as one; a fabricated id here could collide with a real persisted
      // message once the turn is actually sent.
      const { container } = render(<MessageList messages={messages} pendingPrompt={{ text: 'third turn', onCancel: () => {} }} />);
      const queuedEl = screen.getByTestId('chat-pane-queued');
      expect(queuedEl).not.toHaveAttribute('data-message-id');
      expect(container.querySelectorAll('[data-message-id]')).toHaveLength(messages.length);
    });
  });
});
