/**
 * @module MessageList
 *
 * Renders a conversation's messages via `<MessageRow>`, and — matching
 * `useConversation`'s `scrollIntent` flag (see
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §4: "message array, optimistic
 * user message, scroll-intent flag") — auto-scrolls to the newest content
 * whenever `scrollIntent` is true, calling `onScrolled` once it has. Pure
 * DOM scroll-anchoring via a ref lives here (a presentational component),
 * not in the headless `useConversation` hook, per that hook's own
 * "transport-agnostic hooks never touch DOM" contract.
 */
import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../core/index.js';
import { isTerminalRunStatus } from '../../core/index.js';
import { MessageRow, type MessageRowProps } from './MessageRow.js';

export interface MessageListProps extends Pick<MessageRowProps, 'projectFileNames' | 'onRequestOpenFile' | 'renderAttachment'> {
  messages: ChatMessage[];
  isStreaming?: boolean;
  /** Mirrors `useConversation().scrollIntent` — when `true`, this component scrolls to the bottom on mount/update. */
  scrollIntent?: boolean;
  /** Called once the auto-scroll has run, mirroring `useConversation().acknowledgeScroll`. */
  onScrolled?: () => void;
  activeQuestionFormMessageId?: string | null;
  questionFormSubmittedAnswersByMessageId?: Record<string, Record<string, string | string[]>>;
  onQuestionFormSubmit?: (messageId: string, text: string, answers: Record<string, string | string[]>) => void;
}

/** Slack, in px, for treating "close enough to the bottom" as "at the bottom" — a fractional
 * scrollHeight/clientHeight rounding difference should not by itself stop the sticky-follow below. */
const AT_BOTTOM_THRESHOLD_PX = 4;

function isScrolledToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
}

export function MessageList({
  messages,
  isStreaming = false,
  scrollIntent = false,
  onScrolled,
  activeQuestionFormMessageId = null,
  questionFormSubmittedAnswersByMessageId,
  onQuestionFormSubmit,
  projectFileNames,
  onRequestOpenFile,
  renderAttachment,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the transcript was scrolled to its bottom as of the last user scroll or programmatic
  // scroll-to-bottom — read by the ResizeObserver effect below, which only ever sees the DOM AFTER a
  // resize already happened and so cannot recompute "was this at the bottom" from current values.
  // Starts true: a freshly mounted pane opens on the latest turn, same as scrollIntent's own default.
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!scrollIntent) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
    }
    onScrolled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollIntent, messages]);

  // Re-sticks to the bottom when a message ROW grows after mount with no accompanying `messages`
  // change — the exact case an embedded MCP-UI/A2UI surface hits: it mounts at an initial guessed
  // height (`preferredFrameSize` or `DEFAULT_INITIAL_HEIGHT`), then reports its real, often much
  // taller content height asynchronously via `ui/notifications/size-changed`, entirely inside that
  // surface's own React state (`McpUiHost`). The effect above never re-runs for that, so without this
  // a surface which grows after the one-shot scroll leaves its own action buttons — or, once it
  // resolves, the assistant's next reply — below the stale "bottom" with nothing to bring them back
  // into view. Observes each direct child (one per message row) rather than the scroll container
  // itself: the container's own box is held fixed by its flex/overflow layout, so only its CONTENT
  // grows, which `ResizeObserver` only reports for the element whose box is actually changing.
  // Re-created per `messages` change so a newly mounted row is observed too. Gated on
  // `stickToBottomRef` so a human who scrolled up to read history is never yanked back down by an
  // unrelated row resizing elsewhere in the transcript.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messages]);

  return (
    <div
      className="jini-message-list"
      ref={containerRef}
      onScroll={(event) => {
        stickToBottomRef.current = isScrolledToBottom(event.currentTarget);
      }}
      data-agent-element="chat-transcript"
      data-agent-role="list"
      data-agent-label="The conversation transcript, oldest message first"
    >
      {messages.map((message) => {
        const isLast = message.id === messages[messages.length - 1]?.id;
        const runStreaming = isLast && isStreaming && !isTerminalRunStatus(message.runStatus);
        return (
          <MessageRow
            key={message.id}
            message={message}
            runStreaming={runStreaming}
            runSucceeded={message.runStatus === 'succeeded'}
            questionFormInteractive={message.id === activeQuestionFormMessageId}
            {...(questionFormSubmittedAnswersByMessageId?.[message.id] !== undefined ? { questionFormSubmittedAnswers: questionFormSubmittedAnswersByMessageId[message.id] } : {})}
            {...(onQuestionFormSubmit !== undefined ? { onQuestionFormSubmit: (text: string, answers: Record<string, string | string[]>) => onQuestionFormSubmit(message.id, text, answers) } : {})}
            {...(projectFileNames !== undefined ? { projectFileNames } : {})}
            {...(onRequestOpenFile !== undefined ? { onRequestOpenFile } : {})}
            {...(renderAttachment !== undefined ? { renderAttachment } : {})}
          />
        );
      })}
    </div>
  );
}
