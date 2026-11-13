import React, { type ReactNode } from 'react';
import { splitOnQuestionForms } from '../../core/index.js';
import type { ChatMessage } from '../../core/index.js';
import type { ToolTimelineRow } from '../hooks/useToolTimeline.js';
import type { ExtEventGroup } from '../hooks/useExtEventGroups.js';
import type { AnsweredCards } from '../hooks/useAnsweredCards.js';
import type { ExtEventRendererRegistry } from '../ext-event-renderer-registry.js';
import type { MessageBlock } from '../message-blocks.js';
import { retriedToolRowIds, type ToolCallDisplay } from '../tool-call-display.js';
import { usageLineMeetsActions, type usageLayout } from './MessageRow.usage.js';
import type { MessageRowProps, UsageSummary as UsageSummaryComponent, ThinkingBlock as ThinkingBlockComponent, AssistantMessageFooter as AssistantMessageFooterComponent } from './MessageRow.js';
import { MidRunUserMessage, MID_RUN_USER_MESSAGE_EXT_EVENT_NAME } from './MidRunUserMessage.js';
import { ExtEventErrorBoundary } from './ExtEventErrorBoundary.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { QuestionForm } from './QuestionForm.js';
import { ToolCallGroup } from './ToolCallGroup.js';

type AssistantBlock = MessageBlock<ToolTimelineRow>;

/** Preserve optional render-prop presence for custom extension renderers. */
function answerRenderProps({ answeredCards, slot, answerText }: {
  answeredCards: AnsweredCards; slot: string; answerText: string | undefined;
}, _options = {}) {
  return { ...(answeredCards.isRecorded(slot) ? { answerRecorded: true } : {}),
    ...(answerText === undefined ? {} : { answerText }) };
}

/** Build the assistant transcript renderers with the current row's state and host callbacks. */
export function useAssistantMessageRenderers({ message, rows, runStreaming, runSucceeded, projectFileNames, onRequestOpenFile, toolCallDisplay, registry, answeredCards, runInProgress, awaitingAnswer, questionFormInteractive, questionFormSubmittedAnswers, onQuestionFormSubmit, usage, showUsageLine, showUsageTotal, lastFinishedReply, extGroups, footerUsage, terminalNotice, pending, runSending, sendingLabel, visibleContent, flatTools, flatExtGroups, UsageSummary, ThinkingBlock, AssistantMessageFooter }: {
  message: ChatMessage; rows: ToolTimelineRow[]; runStreaming: boolean; runSucceeded: boolean;
  projectFileNames: MessageRowProps['projectFileNames']; onRequestOpenFile: MessageRowProps['onRequestOpenFile']; toolCallDisplay: ToolCallDisplay;
  registry: ExtEventRendererRegistry; answeredCards: AnsweredCards; runInProgress: boolean; awaitingAnswer: boolean;
  questionFormInteractive: boolean; questionFormSubmittedAnswers: MessageRowProps['questionFormSubmittedAnswers']; onQuestionFormSubmit: MessageRowProps['onQuestionFormSubmit'];
  usage: ReturnType<typeof usageLayout>; showUsageLine: boolean; showUsageTotal: boolean; lastFinishedReply: number;
  extGroups: ExtEventGroup[]; footerUsage: ReturnType<typeof usageLayout>['footer']; terminalNotice: string | null; pending: boolean; runSending: boolean;
  sendingLabel: string | undefined; visibleContent: string; flatTools: { rows: readonly ToolTimelineRow[]; key: string }[]; flatExtGroups: ExtEventGroup[];
  UsageSummary: typeof UsageSummaryComponent; ThinkingBlock: typeof ThinkingBlockComponent; AssistantMessageFooter: typeof AssistantMessageFooterComponent;
}, _options = {}) {
  const retriedRows = retriedToolRowIds({ rows });
  const renderToolCard = (row: ToolTimelineRow) => (
    <ToolCard
      key={row.id}
      retried={retriedRows.has(row.id)}
      use={row.use}
      result={row.result}
      runStreaming={runStreaming}
      runSucceeded={runSucceeded}
      {...(projectFileNames !== undefined ? { projectFileNames } : {})}
      {...(onRequestOpenFile !== undefined ? { onRequestOpenFile } : {})}
    />
  );

  // Hidden mode reuses the same disclosure and card renderer for unrecovered failures.
  const renderTools = (rows: readonly ToolTimelineRow[], key?: string) => (toolCallDisplay !== 'show'
    ? <ToolCallGroup key={key} rows={rows} renderRow={renderToolCard} failureOnly={toolCallDisplay === 'hidden'} />
    : <div className="jini-message-tools" key={key}>{rows.map(renderToolCard)}</div>);

  const renderExtGroup = (group: ExtEventGroup) => {
    const transcriptRow = group.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME;
    const renderer = registry.get({ name: group.name });
    if (!renderer && group.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME) return <MidRunUserMessage key={group.slot} events={group.events} runStreaming={runInProgress} transcriptRow />;
    if (!renderer) return null;
    const answerText = answeredCards.answerText(group.slot);
    const node = renderer({
      name: group.name,
      events: group.events,
      runStreaming: group.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME ? runInProgress : answeredCards.runStreaming,
      ...(group.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME ? { transcriptRow: true } : {}),
      runSucceeded,
      awaitingAnswer,
      runId: message.runId,
      ...(group.call === undefined ? {} : { call: group.call }),
      answered: answeredCards.isAnswered(group.slot),
      onAnswered: () => answeredCards.markAnswered(group.slot),
      onAnswerText: (text) => answeredCards.markAnswered(group.slot, text),
      ...answerRenderProps({ answeredCards, slot: group.slot, answerText }),
    });
    if (!node) return null;
    return (
      // `key` includes the event count so a group that failed on an earlier, shorter event list
      // gets a fresh boundary instance (not the still-tripped one) once a new event actually
      // arrives for it, instead of staying tombstoned for the message's whole lifetime.
      <ExtEventErrorBoundary key={`${group.slot}:${group.events.length}`} name={group.name}>
        {transcriptRow ? node : <div>{node}</div>}
      </ExtEventErrorBoundary>
    );
  };

  const renderTextSegments = (text: string, keyPrefix: string): ReactNode =>
    splitOnQuestionForms({ input: text }).map((segment, i) => {
      if (segment.kind === 'text') return segment.text.trim() ? (
          <div className="jini-message-content" key={`${keyPrefix}-${i}`}>
            <Markdown>{segment.text}</Markdown>
          </div>
        ) : null;
      return (
        <QuestionForm
          key={`${keyPrefix}-${i}`}
          form={segment.form}
          interactive={questionFormInteractive}
          {...(questionFormSubmittedAnswers !== undefined ? { submittedAnswers: questionFormSubmittedAnswers } : {})}
          {...(onQuestionFormSubmit !== undefined ? { onSubmit: onQuestionFormSubmit } : {})}
        />
      );
    });

  const renderBlock = (block: AssistantBlock): ReactNode => {
    if (block.kind === 'text') {
      return <React.Fragment key={block.key}>{renderTextSegments(block.text, block.key)}</React.Fragment>;
    }
    if (block.kind === 'reply-end') {
      const reply = usage.replies[block.index];
      // A trailing input may have no reply: its predecessor's usage belongs above that input.
      if (!reply || !showUsageLine) return null;
      return <UsageSummary key={block.key} usage={reply} showTotal={showUsageTotal}
        {...(block.index === lastFinishedReply ? { message } : {})} />;
    }
    if (block.kind === 'tools') return renderTools(block.rows, block.key);
    if (block.kind === 'thinking') return <ThinkingBlock key={block.key} text={block.text} />;
    return renderExtBlock(block);
  };

  // A mid-run bubble is its own transcript row, so it skips the ext-events wrapper and its spacing.
  const renderExtBlock = (block: Extract<AssistantBlock, { kind: 'ext' }>): ReactNode => {
    const group = extGroups.find((g) => g.slot === block.slot);
    if (!group) return null;
    if (group.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME) return <React.Fragment key={block.key}>{renderExtGroup(group)}</React.Fragment>;
    return (
      <div className="jini-message-ext-events" key={block.key}>
        {renderExtGroup(group)}
      </div>
    );
  };

  // The live footer follows the run as transcript sections split; its clock must not remount.
  const renderAssistantSection = ({ section, key, footer }: {
    section: readonly AssistantBlock[] | null; key: string; footer: boolean;
  }) => (
    <div
      key={footer ? message.id : key}
      className={usageLineMeetsActions({ footer: footerUsage, terminalNotice, pending, runInProgress }, { showTotal: showUsageTotal })
        ? 'jini-message jini-message-assistant jini-message-assistant--usage-actions'
        : 'jini-message jini-message-assistant'}
      data-message-id={message.id}
      data-run-status={message.runStatus}
      data-agent-element={`chat-message-${message.id}`}
      data-agent-role="region"
      data-agent-label="A reply from the assistant"
    >
      {message.agentName ? <div className="jini-message-agent">{message.agentName}</div> : null}
      {section
        ? section.map(renderBlock)
        : (
          <>
            {renderTextSegments(visibleContent, 'text')}
            {flatTools.map((group) => renderTools(group.rows, group.key))}
            {flatExtGroups.length > 0 ? <div className="jini-message-ext-events">{flatExtGroups.map(renderExtGroup)}</div> : null}
          </>
        )}
      {footer && <AssistantMessageFooter {...{ message, usageEvent: footerUsage, showUsageTotal, terminalNotice, pending, runInProgress, runStreaming, runSending, sendingLabel, visibleContent, isAnsweredCard: answeredCards.isAnsweredCard }} />}
    </div>
  );
  return { renderBlock, renderExtGroup, renderAssistantSection };
}
