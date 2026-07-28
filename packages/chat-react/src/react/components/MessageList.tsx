/**
 * @module MessageList
 *
 * Renders a conversation's messages via `<MessageRow>`, and — matching
 * `useConversation`'s `scrollIntent` flag (see
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §4: "message array, optimistic
 * user message, scroll-intent flag") — auto-scrolls to the newest content
 * whenever `scrollIntent` is true, calling `onScrolled` once it has. Pure
 * DOM scroll-anchoring via a ref lives here (a presentational component),
 * not in the headless `useConversation` hook, per that hook's own
 * "transport-agnostic hooks never touch DOM" contract.
 */
import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@jini-ai/chat-core';
import { isTerminalRunStatus } from '@jini-ai/chat-core';
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

  useEffect(() => {
    if (!scrollIntent) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    onScrolled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollIntent, messages]);

  return (
    <div className="jini-message-list" ref={containerRef}>
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
