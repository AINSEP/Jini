/**
 * @module MessageRow
 *
 * Renders one `ChatMessage` — a dumb, props-in/JSX-out composition of this
 * package's own leaves (`<Markdown>`, `<ToolCard>` via `useToolTimeline`,
 * `<QuestionForm>` via `splitOnQuestionForms`). Unlike `ToolCard`/
 * `QuestionForm`/`TodoCard`/`NextStepActions`, this component is NOT a
 * direct port of an OD file: the two source branches this package was built
 * from (`refactor/web-chat-pane-slice`, `refactor/web-chat-composer-slice-pr`)
 * decompose `ChatPane.tsx`/`ChatComposer.tsx`, not `AssistantMessage.tsx`
 * (3,317 lines) — that god-component's own vertical-slice extraction is a
 * separate, not-yet-dispatched task (see
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §3's suggested "AssistantMessage
 * first" ordering, which this task's sources don't cover). This is
 * therefore a fresh, reasonable v1 composition of the already-ported leaves,
 * not a byte-for-byte port — text and question-forms interleave in original
 * order (via `splitOnQuestionForms`).
 *
 * Tool cards now interleave too (`../message-blocks.js`), which they did not in
 * v1. That original deferral fused the text on either side of a tool call into
 * one run — a message read as `"I'll look for a tool that changes the
 * language.Done — the language is now English."`, two thoughts from before and
 * after the call joined mid-sentence, with every card pooled at the bottom.
 * `AssistantMessage.tsx`'s richer derivations (`deriveFileOps`/
 * `stripTodoToolGroups`/etc.) remain a TODO for that god-component's own
 * extraction task; plain ordering did not need to wait for them.
 *
 * `interleaveMessageBlocks` returns `null` when it cannot prove the
 * reconstruction is lossless, and this component then renders exactly the flat
 * layout it always did. Both paths are live, so the fallback is not dead code —
 * see that module's header for the conditions.
 */
import React, { type ReactNode } from 'react';
import type { AgentEvent, ChatAttachment, ChatMessage } from '../../core/index.js';
import { splitOnQuestionForms, stripArtifact } from '../../core/index.js';
import { useToolTimeline, type ToolTimelineRow } from '../hooks/useToolTimeline.js';
import { useExtEventGroups } from '../hooks/useExtEventGroups.js';
import { interleaveMessageBlocks } from '../message-blocks.js';
import { useT } from '../hooks/context.js';
import { getExtEventRenderer } from '../ext-event-renderer-registry.js';
import { ExtEventErrorBoundary } from './ExtEventErrorBoundary.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { QuestionForm } from './QuestionForm.js';

export interface MessageRowProps {
  message: ChatMessage;
  /** Whether this message's own run is still streaming. */
  runStreaming?: boolean;
  runSucceeded?: boolean;
  /** Whether this message's question-form (if any) is still the active/answerable one. */
  questionFormInteractive?: boolean;
  questionFormSubmittedAnswers?: Record<string, string | string[]>;
  onQuestionFormSubmit?: (text: string, answers: Record<string, string | string[]>) => void;
  projectFileNames?: Set<string>;
  onRequestOpenFile?: (name: string) => void;
  /** Host-supplied renderer for a `ChatAttachment` chip. Falls back to a plain filename chip. */
  renderAttachment?: (attachment: ChatAttachment) => ReactNode;
}

type UsageEvent = Extract<AgentEvent, { kind: 'usage' }>;

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** One "Done · 6m 29s · 2612 out · $0.4028" summary line, from the run's own `kind:'usage'` event — never estimated client-side. Renders only the fields the event actually carries, so a transport that supplies partial usage data degrades gracefully instead of showing fabricated zeros. */
function UsageSummary({ usage }: { usage: UsageEvent }) {
  const t = useT();
  const parts: string[] = [];
  if (usage.durationMs !== undefined) parts.push(formatDuration(usage.durationMs));
  if (usage.outputTokens !== undefined) parts.push(t('{n} out', { n: usage.outputTokens }));
  if (usage.costUsd !== undefined) parts.push(`$${usage.costUsd.toFixed(4)}`);
  if (parts.length === 0) return null;
  return (
    <div className="jini-message-usage">
      <span className="jini-message-usage-dot" aria-hidden>●</span>
      {t('Done')} · {parts.join(' · ')}
    </div>
  );
}

export function MessageRow({
  message,
  runStreaming = false,
  runSucceeded = false,
  questionFormInteractive = false,
  questionFormSubmittedAnswers,
  onQuestionFormSubmit,
  projectFileNames,
  onRequestOpenFile,
  renderAttachment,
}: MessageRowProps) {
  const t = useT();
  const timeline = useToolTimeline(message.events, { runStreaming, runSucceeded });
  const extGroups = useExtEventGroups(message.events);

  if (message.role === 'user') {
    return (
      <div
        className="jini-message jini-message-user"
        data-message-id={message.id}
        data-agent-element={`chat-message-${message.id}`}
        data-agent-role="region"
        data-agent-label="A message from the user"
      >
        {message.attachments && message.attachments.length > 0 ? (
          <div className="jini-message-attachments">
            {message.attachments.map((a) => (
              <span key={a.path} className="jini-message-attachment-chip">
                {renderAttachment ? renderAttachment(a) : a.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="jini-message-content">{message.content}</div>
      </div>
    );
  }

  const visibleContent = stripArtifact(message.content);
  const segments = splitOnQuestionForms(visibleContent);
  const usageEvent = message.events?.filter((ev): ev is UsageEvent => ev.kind === 'usage').pop();

  // Interleaving is skipped outright when an artifact was stripped. `stripArtifact` operates on the
  // whole string and trims, so the surviving text no longer lines up with the per-run offsets the
  // event walk produces, and an artifact block could legitimately span a tool call. Rather than
  // reason about partial overlaps, an artifact-bearing message keeps the flat layout — those
  // messages are dominated by the artifact panel anyway, so the ordering matters least there.
  const blocks =
    visibleContent === message.content ? interleaveMessageBlocks<ToolTimelineRow>(message.events, message.content, timeline.rows) : null;

  const renderToolCard = (row: ToolTimelineRow) => (
    <ToolCard
      key={row.id}
      use={row.use}
      result={row.result}
      runStreaming={runStreaming}
      runSucceeded={runSucceeded}
      {...(projectFileNames !== undefined ? { projectFileNames } : {})}
      {...(onRequestOpenFile !== undefined ? { onRequestOpenFile } : {})}
    />
  );

  const renderTextSegments = (text: string, keyPrefix: string): ReactNode =>
    splitOnQuestionForms(text).map((segment, i) =>
      segment.kind === 'text' ? (
        segment.text.trim() ? (
          <div className="jini-message-content" key={`${keyPrefix}-${i}`}>
            <Markdown>{segment.text}</Markdown>
          </div>
        ) : null
      ) : (
        <QuestionForm
          key={`${keyPrefix}-${i}`}
          form={segment.form}
          interactive={questionFormInteractive}
          {...(questionFormSubmittedAnswers !== undefined ? { submittedAnswers: questionFormSubmittedAnswers } : {})}
          {...(onQuestionFormSubmit !== undefined ? { onSubmit: onQuestionFormSubmit } : {})}
        />
      ),
    );

  return (
    <div
      className="jini-message jini-message-assistant"
      data-message-id={message.id}
      data-run-status={message.runStatus}
      data-agent-element={`chat-message-${message.id}`}
      data-agent-role="region"
      data-agent-label="A reply from the assistant"
    >
      {message.agentName ? <div className="jini-message-agent">{message.agentName}</div> : null}
      {blocks
        ? blocks.map((block) =>
            block.kind === 'text' ? (
              <React.Fragment key={block.key}>{renderTextSegments(block.text, block.key)}</React.Fragment>
            ) : (
              <div className="jini-message-tools" key={block.key}>
                {block.rows.map(renderToolCard)}
              </div>
            ),
          )
        : (
          <>
            {segments.map((segment, i) =>
              segment.kind === 'text' ? (
                segment.text.trim() ? (
                  <div className="jini-message-content" key={i}>
                    <Markdown>{segment.text}</Markdown>
                  </div>
                ) : null
              ) : (
                <QuestionForm
                  key={i}
                  form={segment.form}
                  interactive={questionFormInteractive}
                  {...(questionFormSubmittedAnswers !== undefined ? { submittedAnswers: questionFormSubmittedAnswers } : {})}
                  {...(onQuestionFormSubmit !== undefined ? { onSubmit: onQuestionFormSubmit } : {})}
                />
              ),
            )}
            {timeline.rows.length > 0 ? (
              <div className="jini-message-tools">{timeline.rows.map(renderToolCard)}</div>
            ) : null}
          </>
        )}
      {extGroups.length > 0 ? (
        <div className="jini-message-ext-events">
          {extGroups.map((group) => {
            const renderer = getExtEventRenderer(group.name);
            if (!renderer) return null;
            const node = renderer({ name: group.name, events: group.events, runStreaming, runSucceeded, runId: message.runId });
            if (!node) return null;
            return (
              // `key` includes the event count so a group that failed on an earlier, shorter
              // event list gets a fresh boundary instance (not the still-tripped one) once a new
              // event actually arrives for it, instead of staying tombstoned for the message's
              // whole lifetime.
              <ExtEventErrorBoundary key={`${group.name}:${group.events.length}`} name={group.name}>
                <div>{node}</div>
              </ExtEventErrorBoundary>
            );
          })}
        </div>
      ) : null}
      {usageEvent ? <UsageSummary usage={usageEvent} /> : null}
      {message.runStatus === 'failed' ? <div className="jini-message-error">{t('This turn failed.')}</div> : null}
      {message.runStatus === 'running' && !visibleContent.trim() && timeline.rows.length === 0 ? (
        <div className="jini-message-pending" aria-live="polite">
          {t('Thinking…')}
        </div>
      ) : null}
    </div>
  );
}
