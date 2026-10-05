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
import type { ChatMessage } from '../../core/index.js';
import { isTerminalRunStatus } from '../../core/index.js';
import { useT } from '../hooks/context.js';
import { useMessageListAutoScroll } from './MessageList.hooks.js';
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
  /**
   * A composer-driven turn typed while a run is in flight, mirroring `useChatPane().queuedPrompt` —
   * rendered as the newest transcript entry (like Claude Code/ChatGPT's own pending-turn UI)
   * instead of a banner bolted above the composer. Deliberately NOT a `ChatMessage`: it has no
   * persisted id (nothing here could mint one without risking collision with a real message once
   * this prompt is actually sent) and is never written to `messages`/storage — purely a rendering
   * of `useChatPane`'s own in-memory queue slot. `null`/omitted renders nothing, matching the old
   * strip's "shown only once something is actually queued" behavior.
   */
  pendingPrompt?: { text: string; onCancel: () => void } | null;
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
  pendingPrompt = null,
}: MessageListProps) {
  const t = useT();
  const { containerRef, onScroll } = useMessageListAutoScroll({ messages, scrollIntent }, onScrolled !== undefined ? { onScrolled } : {});

  return (
    <div
      className="jini-message-list"
      ref={containerRef}
      onScroll={onScroll}
      data-agent-element="chat-transcript"
      data-agent-role="list"
      data-agent-label="The conversation transcript, oldest message first"
    >
      {messages.map((message) => {
        const isLast = message.id === messages[messages.length - 1]?.id;
        const runStreaming = isLast && isStreaming && !isTerminalRunStatus({ status: message.runStatus });
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
      {pendingPrompt ? (
        <div
          className="jini-chat-pane__queued"
          role="status"
          aria-label={t('Message queued — not yet sent, will send once the current run finishes')}
          data-testid="chat-pane-queued"
          data-agent-element="chat-message-pending"
          data-agent-role="region"
          data-agent-label="A message queued to send once the current run finishes"
        >
          <div className="jini-chat-pane__queued-text">{pendingPrompt.text}</div>
          <div className="jini-chat-pane__queued-actions">
            <button
              type="button"
              className="jini-chat-pane__queued-cancel"
              onClick={pendingPrompt.onCancel}
              title={t('Cancel queued message')}
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
