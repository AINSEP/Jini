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
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §3's suggested "AssistantMessage
 * first" ordering, which this task's sources don't cover). This is
 * therefore a fresh, reasonable v1 composition of the already-ported leaves,
 * not a byte-for-byte port — text and question-forms interleave in original
 * order (via `splitOnQuestionForms`), but tool cards currently render as one
 * block after the text rather than fully interleaved at their original
 * position in the event stream (`AssistantMessage.tsx`'s real interleaving
 * logic — `deriveFileOps`/`stripTodoToolGroups`/etc. — is a TODO follow-up
 * once that god-component gets its own extraction task).
 */
import type { ReactNode } from 'react';
import type { AgentEvent, ChatAttachment, ChatMessage } from '@injini/chat-core';
import { splitOnQuestionForms, stripArtifact } from '@injini/chat-core';
import { useToolTimeline } from '../hooks/useToolTimeline.js';
import { useT } from '../hooks/context.js';
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

  if (message.role === 'user') {
    return (
      <div className="jini-message jini-message-user" data-message-id={message.id}>
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

  return (
    <div className="jini-message jini-message-assistant" data-message-id={message.id} data-run-status={message.runStatus}>
      {message.agentName ? <div className="jini-message-agent">{message.agentName}</div> : null}
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
        <div className="jini-message-tools">
          {timeline.rows.map((row) => (
            <ToolCard key={row.id} use={row.use} result={row.result} runStreaming={runStreaming} runSucceeded={runSucceeded} {...(projectFileNames !== undefined ? { projectFileNames } : {})} {...(onRequestOpenFile !== undefined ? { onRequestOpenFile } : {})} />
          ))}
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
