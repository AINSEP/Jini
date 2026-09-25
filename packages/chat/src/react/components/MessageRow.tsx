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
 *
 * Both message roles also carry a per-message copy affordance
 * (`CopyMessageButton` below), rendered inside a `.jini-message-actions` row.
 * Assistant rows render that row as an extension seam: `branch`/thumbs-up/
 * thumbs-down are meant to join `copy` there later, as siblings in the same
 * row, once their backends (conversation branching, feedback storage) exist
 * — see the seam comment at that row's call site. Copy always copies the raw
 * markdown *source* — `message.content` (user) or `visibleContent`
 * (assistant, post `stripArtifact`) — never a flattened read of the rendered
 * DOM, so a table, fence, or `**bold**` marker survives the round trip.
 *
 * The assistant action row is further withheld while `message.runStatus`
 * has not yet reached a terminal state (`isRunInProgress` below) — not just
 * while there is literally nothing to show (`isPendingWithNoContent`).
 * Text and tool rows can settle onto the screen before the run itself ends
 * (e.g. a trailing tool call still in flight), and the copy affordance must
 * not appear until the whole message is done, not merely until its current
 * chunk stopped arriving.
 */
import React, { useState, type ReactNode } from 'react';
import type { AgentEvent, ChatAttachment, ChatMessage, ChatRunStatus } from '../../core/index.js';
import { isTerminalRunStatus, splitOnQuestionForms, stripArtifact } from '../../core/index.js';
import { useToolTimeline, type ToolTimelineRow } from '../hooks/useToolTimeline.js';
import { useExtEventGroups, type ExtEventGroup } from '../hooks/useExtEventGroups.js';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { interleaveMessageBlocks } from '../message-blocks.js';
import { useT } from '../hooks/context.js';
import { getExtEventRenderer } from '../ext-event-renderer-registry.js';
import { ExtEventErrorBoundary } from './ExtEventErrorBoundary.js';
import { AttachmentPreviewModal } from './AttachmentPreviewModal.js';
import { Icon } from './Icon.js';
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

/**
 * True while an assistant message is still fully pending — no visible text
 * and no tool rows have arrived yet. Shared by the "Thinking…" placeholder
 * and the action row's own visibility below, since the two are mutually
 * exclusive by construction: a message with nothing to show yet has nothing
 * worth a copy/branch/feedback row either. Pulled out of `MessageRow` itself
 * (rather than inlined at each call site, as it was before this row existed)
 * so the condition is asserted once instead of duplicated.
 * @param message - The message being rendered.
 * @param visibleContent - `message.content` with any `<artifact>` block stripped.
 * @param toolRowCount - `useToolTimeline(...).rows.length` for this message.
 * @complexity O(1) — three comparisons, no loops or recursion.
 */
function isPendingWithNoContent(message: ChatMessage, visibleContent: string, toolRowCount: number): boolean {
  return message.runStatus === 'running' && !visibleContent.trim() && toolRowCount === 0;
}

/**
 * True while an assistant message's own run has been handed a lifecycle status but has not yet
 * reached a terminal one (`succeeded` | `failed` | `canceled`) — this covers `running` and also
 * `queued`, the brief window before streaming starts. A message whose `runStatus` is `undefined`
 * (no live run ever attached — e.g. history loaded from storage) is never "in progress": only a
 * message actively wired to a lifecycle status can be mid-run, so those messages fall through to
 * "done" rather than being treated as perpetually running.
 *
 * This is deliberately broader than `isPendingWithNoContent` above: that predicate answers "is
 * there nothing to show yet" (content OR a tool row already arriving flips it to false), while
 * this one answers "has the run itself finished" — the actual reported bug was text/tool rows
 * already on screen while a trailing tool call was still in flight, i.e. not-pending but also
 * not-done. The two are combined at the copy-button call site rather than merged into one
 * predicate, since `isPendingWithNoContent` still owns the separate "Thinking…" placeholder.
 * @param runStatus - `message.runStatus` from the message being rendered.
 * @complexity O(1) — one comparison plus a set lookup via `isTerminalRunStatus`.
 */
function isRunInProgress(runStatus: ChatRunStatus | undefined): boolean {
  return runStatus !== undefined && !isTerminalRunStatus(runStatus);
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

interface CopyMessageButtonProps {
  /** The raw markdown source to place on the clipboard — never rendered/flattened text. */
  text: string;
  /** Accessible name while idle; swaps to a "Copied" label once the copy lands. */
  label: string;
}

/**
 * Quiet, icon-only copy affordance shared by the user- and assistant-message
 * action rows below. Delegates the actual clipboard write (and its
 * secure-context fallback) to `useCopyToClipboard`; this component only owns
 * the icon swap and the accessible announcement of the transient state.
 * @param props.text - Exact string to copy, verbatim.
 * @param props.label - Idle accessible name (already translated by the caller).
 * @complexity O(1) — one child hook call, no branching beyond the copied-state read.
 */
function CopyMessageButton({ text, label }: CopyMessageButtonProps) {
  const t = useT();
  const { copied, copy } = useCopyToClipboard();
  return (
    <>
      <button
        type="button"
        className="jini-message-action-btn"
        aria-label={copied ? t('Copied') : label}
        onClick={() => {
          void copy(text);
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
      {/* Visually hidden, not decorative: the icon swap above says nothing to a screen reader on
          its own, so this polite live region announces the same transient state in words. */}
      <span className="jini-message-copy-status" aria-live="polite">
        {copied ? t('Copied to clipboard') : ''}
      </span>
    </>
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
  // Which attachment chip (if any) this row's preview modal is open for. Row-local, not
  // module-level: two attachments in the same message can never be "open" at once, but two
  // different messages opening their own attachments independently is fine and expected.
  const [openAttachment, setOpenAttachment] = useState<ChatAttachment | null>(null);

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
              <button
                key={a.path}
                type="button"
                className="jini-message-attachment-chip"
                onClick={() => setOpenAttachment(a)}
                title={t('Open {name}', { name: a.name })}
                aria-label={t('Open {name}', { name: a.name })}
              >
                {renderAttachment ? renderAttachment(a) : a.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="jini-message-content">{message.content}</div>
        <div className="jini-message-actions jini-message-actions--user">
          <CopyMessageButton text={message.content} label={t('Copy message')} />
        </div>
        {openAttachment ? (
          <AttachmentPreviewModal attachment={openAttachment} onClose={() => setOpenAttachment(null)} />
        ) : null}
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
  const pending = isPendingWithNoContent(message, visibleContent, timeline.rows.length);
  const runInProgress = isRunInProgress(message.runStatus);

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

  const renderExtGroup = (group: ExtEventGroup) => {
    const renderer = getExtEventRenderer(group.name);
    if (!renderer) return null;
    const node = renderer({ name: group.name, events: group.events, runStreaming, runSucceeded, runId: message.runId });
    if (!node) return null;
    return (
      // `key` includes the event count so a group that failed on an earlier, shorter event list
      // gets a fresh boundary instance (not the still-tripped one) once a new event actually
      // arrives for it, instead of staying tombstoned for the message's whole lifetime.
      <ExtEventErrorBoundary key={`${group.name}:${group.events.length}`} name={group.name}>
        <div>{node}</div>
      </ExtEventErrorBoundary>
    );
  };

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
        ? blocks.map((block) => {
            if (block.kind === 'text') {
              return <React.Fragment key={block.key}>{renderTextSegments(block.text, block.key)}</React.Fragment>;
            }
            if (block.kind === 'tools') {
              return (
                <div className="jini-message-tools" key={block.key}>
                  {block.rows.map(renderToolCard)}
                </div>
              );
            }
            const group = extGroups.find((g) => g.name === block.name);
            if (!group) return null;
            return (
              <div className="jini-message-ext-events" key={block.key}>
                {renderExtGroup(group)}
              </div>
            );
          })
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
            {extGroups.length > 0 ? <div className="jini-message-ext-events">{extGroups.map(renderExtGroup)}</div> : null}
          </>
        )}
      {usageEvent ? <UsageSummary usage={usageEvent} /> : null}
      {message.runStatus === 'failed' ? <div className="jini-message-error">{t('This turn failed.')}</div> : null}
      {!pending && !runInProgress ? (
        <div className="jini-message-actions jini-message-actions--assistant">
          <CopyMessageButton text={visibleContent} label={t('Copy message')} />
          {/* Extension seam: branch/thumbs-up/thumbs-down join here next, as siblings after copy,
              same .jini-message-action-btn ghost icon-button shape and fixed left-to-right order
              (copy, branch, thumbs-up, thumbs-down) — left unbuilt per this task's module doc
              above until their backends (conversation branching, feedback storage) exist. */}
        </div>
      ) : null}
      {pending ? (
        <div className="jini-message-pending" aria-live="polite">
          {t('Thinking…')}
        </div>
      ) : null}
    </div>
  );
}
