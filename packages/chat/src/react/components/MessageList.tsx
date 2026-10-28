/**
 * @module MessageList
 *
 * Renders a conversation's messages via `<MessageRow>`, and — matching
 * `useConversation`'s `scrollIntent` flag (see
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §4: "message array, optimistic
 * user message, scroll-intent flag") — auto-scrolls to the newest content
 * whenever `scrollIntent` is true, calling `onScrolled` once it has. The
 * scroll-anchoring state lives in `useMessageListAutoScroll`
 * (`MessageList.hooks.ts`); see that file for why it is presentational.
 */
import { memo, useMemo } from 'react';
import { projectAcceptedInputMessages } from '../../core/accepted-input.js';
import type { ChatAttachment, ChatMessage } from '../../core/index.js';
import { isTerminalRunStatus } from '../../core/index.js';
import type { ChatUsageSummary } from '../../core/turn-usage.js';
import { useT } from '../hooks/context.js';
import { useMessageListAutoScroll, useConversationUsage } from './MessageList.hooks.js';
import { MessageRow, type MessageRowProps } from './MessageRow.js';
import { SentAttachmentButton } from './SentAttachment.js';
import { AttachmentPreviewModal } from './AttachmentPreviewModal.js';
import { useAttachmentGallery } from './AttachmentGallery.hooks.js';

interface PendingPrompt {
  id?: string;
  text: string;
  attachments?: ChatAttachment[];
  onCancel: () => void;
}

export interface MessageListProps extends Pick<MessageRowProps, 'projectFileNames' | 'onRequestOpenFile' | 'renderAttachment' | 'showUsageTotal' | 'showUsageLine' | 'toolCallDisplay' | 'showThinking'> {
  messages: ChatMessage[];
  isStreaming?: boolean;
  /** Mirrors `useConversation().scrollIntent` — when `true`, this component scrolls to the bottom on mount/update. */
  scrollIntent?: boolean;
  /** Called once the auto-scroll has run, mirroring `useConversation().acknowledgeScroll`. */
  onScrolled?: () => void;
  activeQuestionFormMessageId?: string | null;
  questionFormSubmittedAnswersByMessageId?: Record<string, Record<string, string | string[]>>;
  onQuestionFormSubmit?: (messageId: string, text: string, answers: Record<string, string | string[]>) => void;
  /**
   * MOVE: Pending inputs render as the newest transcript entries, never persisted ChatMessages.
   * Their accepted ids identify cancellations; the singular prop remains a host compatibility seam.
   */
  pendingPrompt?: PendingPrompt | null;
  pendingPrompts?: readonly PendingPrompt[];
}

function renderMessageRow(
  { message, isLast, isStreaming, usageSummary, sending }: {
    message: ChatMessage;
    isLast: boolean;
    sending: boolean;
    isStreaming: boolean;
    usageSummary: ChatUsageSummary | undefined;
  },
  { activeQuestionFormMessageId, questionFormSubmittedAnswersByMessageId, onQuestionFormSubmit, ...rowProps }: Omit<MessageListProps, 'messages' | 'isStreaming' | 'scrollIntent' | 'onScrolled' | 'pendingPrompt' | 'pendingPrompts'> = {},
) {
  const runStreaming = isLast && isStreaming && !isTerminalRunStatus({ status: message.runStatus });
  return (
    <MessageRow
      key={message.id}
      message={message}
      // MessageRow owns the display defaults; forward host overrides without duplicating them here.
      {...rowProps}
      {...(usageSummary === undefined ? {} : { usageSummary })}
      runStreaming={runStreaming}
      runSending={sending}
      runSucceeded={message.runStatus === 'succeeded'}
      questionFormInteractive={message.id === activeQuestionFormMessageId}
      {...(questionFormSubmittedAnswersByMessageId?.[message.id] !== undefined ? { questionFormSubmittedAnswers: questionFormSubmittedAnswersByMessageId[message.id] } : {})}
      {...(onQuestionFormSubmit !== undefined ? { onQuestionFormSubmit: (text: string, answers: Record<string, string | string[]>) => onQuestionFormSubmit(message.id, text, answers) } : {})}
    />
  );
}

/**
 * Memoized: the pane re-renders on every composer keystroke, and re-rendering a long transcript
 * (hundreds of tool rows, MCP-UI cards, markdown) per key made typing lag (owner report
 * 2026-10-08). Callers must pass stable props — `ChatPane` memoizes `pendingPrompts` and
 * `projectFileNames` for exactly this.
 */
export const MessageList = memo(function MessageList({
  messages: sourceMessages,
  isStreaming = false,
  scrollIntent = false,
  onScrolled,
  pendingPrompt,
  pendingPrompts,
  ...rowProps
}: MessageListProps) {
  const messages = useMemo(() => projectAcceptedInputMessages({ messages: sourceMessages }), [sourceMessages]);
  const usageByMessage = useConversationUsage({ messages });
  const { containerRef, onScroll, awayFromLatest, jumpToLatest } = useMessageListAutoScroll({ messages, scrollIntent }, onScrolled !== undefined ? { onScrolled } : {});

  return (
    <div
      className="jini-message-list"
      ref={containerRef}
      onScroll={onScroll}
      data-agent-element="chat-transcript"
      data-agent-role="list"
      data-agent-label="The conversation transcript, oldest message first"
    >
      {messages.map((message, index) => renderMessageRow({
        message,
        isLast: message.id === messages[messages.length - 1]?.id,
        // A reply's start is accepted together with its user turn (`inputPending` clears then).
        sending: messages[index - 1]?.inputPending === true,
        isStreaming,
        usageSummary: usageByMessage.get(message.id),
      }, rowProps))}
      {(pendingPrompts ?? (pendingPrompt ? [pendingPrompt] : [])).map((prompt, index) => (
        <QueuedMessage key={prompt.id ?? index} prompt={prompt} renderAttachment={rowProps.renderAttachment} />
      ))}
      {awayFromLatest && <JumpToLatest onJump={jumpToLatest} />}
    </div>
  );
});

/**
 * Sticky, zero-height last child of the scroll container, so the button floats centred just above
 * the composer without a wrapper element changing the pane's flex layout.
 */
function JumpToLatest({ onJump }: { onJump: () => void }) {
  const t = useT();
  return (
    <div className="jini-message-list__jump">
      <button type="button" className="jini-message-list__jump-btn" onClick={onJump}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
        </svg>
        {t('Jump to latest')}
      </button>
    </div>
  );
}

/** One cancelable queue receipt; attachment rendering reuses the sent-message preview owner. */
function QueuedMessage({ prompt, renderAttachment }: {
  prompt: PendingPrompt; renderAttachment: MessageRowProps['renderAttachment'];
}) {
  const t = useT();
  const attachments = prompt.attachments ?? [];
  const gallery = useAttachmentGallery({ attachments });
  return (
    <div
      className="jini-chat-pane__queued"
      role="status"
      aria-label={t('Message queued — not yet sent, will send once the current run finishes')}
      data-testid="chat-pane-queued"
      data-agent-element="chat-message-pending"
      data-agent-role="region"
      data-agent-label="A message queued to send once the current run finishes"
    >
      <div>{t('Queued — sends when this reply finishes')}</div>
      <div className="jini-chat-pane__queued-text">{prompt.text}</div>
      {attachments.length > 0 && <div className="jini-message-attachments">
        {attachments.map(attachment => <SentAttachmentButton key={attachment.path} attachment={attachment}
          onOpen={gallery.open} renderAttachment={renderAttachment} />)}
      </div>}
      {gallery.opened !== null && <AttachmentPreviewModal attachment={gallery.opened} onClose={gallery.close} navigation={gallery.navigation} />}
      <div className="jini-chat-pane__queued-actions">
        <button
          type="button"
          className="jini-chat-pane__queued-cancel"
          onClick={() => prompt.onCancel()}
          title={t('Cancel queued message')}
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  );
}
