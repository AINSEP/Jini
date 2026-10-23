import { projectAcceptedInputEvents } from '../../core/accepted-input.js';
import { MidRunUserMessage, MID_RUN_USER_MESSAGE_EXT_EVENT_NAME } from './MidRunUserMessage.js';
import { terminalMessageNotice, continuingRunNotice } from '../../core/durable-projection.js';
import type { ChatUsageSummary } from '../../core/turn-usage.js';
import { usageLayout, usageLineMeetsActions, useMessageUsage, useUsageSummary } from './MessageRow.usage.js';
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
import React, { memo, useMemo, type ReactNode } from 'react';
import type { AgentEvent, ChatAttachment, ChatMessage, ChatRunStatus, IsAnsweredCard } from '../../core/index.js';
import { assistantContentFromEvents, isAwaitingAnswer, isTerminalRunStatus, splitOnQuestionForms, stripArtifact } from '../../core/index.js';
import { useToolTimeline, type ToolTimelineRow } from '../hooks/useToolTimeline.js';
import { useExtEventGroups, type ExtEventGroup } from '../hooks/useExtEventGroups.js';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { useRunActivity } from '../hooks/useRunActivity.js';
import { useAnsweredCards } from '../hooks/useAnsweredCards.js';
import { interleaveMessageBlocks, type MessageBlock } from '../message-blocks.js';
import { useT, useExtEventRendererRegistry } from '../hooks/context.js';
import type { ExtEventRendererRegistry } from '../ext-event-renderer-registry.js';
import { ExtEventErrorBoundary } from './ExtEventErrorBoundary.js';
import { AttachmentPreviewModal } from './AttachmentPreviewModal.js';
import { SentAttachmentButton } from './SentAttachment.js';
import { useAttachmentGallery } from './AttachmentGallery.hooks.js';
import { Icon } from './Icon.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { QuestionForm } from './QuestionForm.js';
import { ToolCallGroup } from './ToolCallGroup.js';
import { applyToolCallDisplay, toolRowsForDisplay, type ToolCallDisplay } from '../tool-call-display.js';

export interface MessageRowProps {
  message: ChatMessage;
  /** Per-turn charge and prefix total derived from the complete conversation's persisted events. */
  usageSummary?: ChatUsageSummary;
  /** Append the chat's running total as of each reply ("· total $3.95") to its Done line. On by default
   * (owner, 2026-10-10: keep the total); pass `false` to show only each turn's own cost. */
  showUsageTotal?: boolean;
  /** Show the "Done · time · cost" line(s) at all. On by default; `false` hides every one, total
   * included (a host's "Done line" display choice, 2026-10-11). */
  showUsageLine?: boolean;
  /** How tool calls show (`../tool-call-display.ts`): every card (`'show'`, the default), one
   * fold-up line per turn (`'collapsed'`), or compact unrecovered failures (`'hidden'`). */
  toolCallDisplay?: ToolCallDisplay;
  /** Show the model's reasoning (`thinking` events) as a fold-up block where it happened. Off by
   * default — the transcript never showed it before this option. Needs the interleaved layout; a
   * message that falls back to the flat layout shows none. */
  showThinking?: boolean;
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
  return runStatus !== undefined && !isTerminalRunStatus({ status: runStatus });
}

/** One "Done · 6m 29s · $0.41 · total $2.50" line from reported usage, never estimated (the total is
 * left off when `showTotal` is false). Partial usage stays partial; output tokens are available to
 * assistive technology and in the tooltip. */
function UsageSummary({ usage, showTotal }: { usage: ChatUsageSummary; showTotal: boolean }) {
  const t = useT();
  const { text, title, ariaLabel } = useUsageSummary({ usage }, { showTotal });
  if (!text) return null;
  return (
    <div className="jini-message-usage" title={title} role="note" aria-label={ariaLabel}>
      <span className="jini-message-usage-dot" aria-hidden>●</span>
      {t('Done')} · {text}
    </div>
  );
}

interface CopyMessageButtonProps {
  /** The raw markdown source to place on the clipboard — never rendered/flattened text. */
  text: string;
  /** Accessible name while idle; swaps to a "Copied" label once the copy lands. */
  label: string;
}

function messageBlocks(
  { message, rows, registry, content = message.content }: { message: ChatMessage; rows: ToolTimelineRow[]; registry: ExtEventRendererRegistry; content?: string },
  { toolCallDisplay = 'show', includeThinking = false }: { toolCallDisplay?: ToolCallDisplay; includeThinking?: boolean } = {},
) {
  const blocks = interleaveMessageBlocks<ToolTimelineRow>(
    { events: message.events, content, rows },
    { slotOf: (ev) => registry.slot({ name: ev.name, data: ev.data }), includeThinking },
  );
  return blocks ? applyToolCallDisplay({ blocks, mode: toolCallDisplay }, { runFailed: message.runStatus === 'failed' }) : null;
}

/**
 * The flat layout's tool groups. Even when host text prevents interleaving, event ordering can still
 * prove tool recovery and reply boundaries, so hidden mode reconstructs the blocks from the events —
 * only for this display decision; the host's text is never replaced. Otherwise one flat list.
 * @complexity O(n) in events + rows.
 */
function flatToolGroups(
  { message, rows, registry, displayBlocks }: { message: ChatMessage; rows: ToolTimelineRow[]; registry: ExtEventRendererRegistry; displayBlocks: readonly MessageBlock<ToolTimelineRow>[] | null },
  { toolCallDisplay }: { toolCallDisplay: ToolCallDisplay },
): { rows: readonly ToolTimelineRow[]; key: string }[] {
  if (toolCallDisplay === 'hidden') {
    const recovery = displayBlocks
      ?? messageBlocks({ message, rows, registry, content: assistantContentFromEvents({ events: message.events ?? [] }) }, { toolCallDisplay });
    if (recovery) return recovery.flatMap((block) => (block.kind === 'tools' ? [{ rows: block.rows, key: block.key }] : []));
  }
  const flat = toolRowsForDisplay({ rows, mode: toolCallDisplay }, { runFailed: message.runStatus === 'failed' });
  return flat.length > 0 ? [{ rows: flat, key: 'tools' }] : [];
}

/** The model's reasoning, folded under a "Thinking" summary so it never crowds the answer. */
function ThinkingBlock({ text }: { text: string }) {
  const t = useT();
  if (!text.trim()) return null;
  return (
    <details className="jini-message-thinking">
      <summary>{t('Thinking')}</summary>
      <div className="jini-message-thinking__text">{text}</div>
    </details>
  );
}

function messageAwaitingAnswer(
  { runStreaming, runInProgress, events }: { runStreaming?: boolean; runInProgress: boolean; events: AgentEvent[] | undefined },
  { isAnsweredCard }: { isAnsweredCard?: IsAnsweredCard } = {},
): boolean {
  return runStreaming === true && runInProgress && isAwaitingAnswer({ events }, { isAnsweredCard });
}

function AssistantMessageFooter(
  { message, usageEvent, showUsageTotal, terminalNotice, pending, runInProgress, runStreaming, visibleContent, isAnsweredCard }: {
    message: ChatMessage; usageEvent: ChatUsageSummary | undefined; showUsageTotal: boolean; terminalNotice: string | null;
    pending: boolean; runInProgress: boolean; runStreaming?: boolean; visibleContent: string; isAnsweredCard: IsAnsweredCard;
  }, _optional = {},
) {
  const t = useT();
  return <>
      {usageEvent ? <UsageSummary usage={usageEvent} showTotal={showUsageTotal} /> : null}
      {terminalNotice ? <div className="jini-message-error" role="status">{t(terminalNotice)}</div> : null}
      {!pending && !runInProgress ? (
        <div className="jini-message-actions jini-message-actions--assistant">
          <CopyMessageButton text={visibleContent} label={t('Copy message')} />
          {/* Extension seam: branch/thumbs-up/thumbs-down join here next, as siblings after copy,
              same .jini-message-action-btn ghost icon-button shape and fixed left-to-right order
              (copy, branch, thumbs-up, thumbs-down) — left unbuilt per this task's module doc
              above until their backends (conversation branching, feedback storage) exist. */}
        </div>
      ) : null}
      {runInProgress ? <RunActivityLine events={message.events} active={pending || (runStreaming === true && runInProgress)} isAnsweredCard={isAnsweredCard} /> : null}
  </>;
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

/** Stable empty list for a message with no attachments. */
const NO_ATTACHMENTS: readonly ChatAttachment[] = [];

/** The display props `MessageRow` defaults, resolved — what `AssistantMessageRow` renders from. */
type ResolvedMessageRowProps = MessageRowProps
  & Required<Pick<MessageRowProps, 'showUsageTotal' | 'showUsageLine' | 'toolCallDisplay' | 'showThinking' | 'runStreaming' | 'runSucceeded' | 'questionFormInteractive'>>;

type AssistantBlock = MessageBlock<ToolTimelineRow>;

/**
 * Memoized so a transcript re-render (a streaming update to the newest message, or a parent that
 * re-renders per composer keystroke) only re-renders rows whose props actually changed. Messages
 * are replaced, never mutated, so identity is a sound change signal.
 */
export const MessageRow = memo(function MessageRow({
  showUsageTotal = true,
  showUsageLine = true,
  toolCallDisplay = 'show',
  showThinking = false,
  runStreaming = false,
  runSucceeded = false,
  questionFormInteractive = false,
  ...props
}: MessageRowProps) {
  const message = useMemo(() => props.message.events === undefined ? props.message : {
    ...props.message, events: projectAcceptedInputEvents({ events: props.message.events }),
  }, [props.message]);
  if (message.role === 'user') return <UserMessageRow {...props} message={message} />;
  return <AssistantMessageRow {...props} message={message} {...{ showUsageTotal, showUsageLine, toolCallDisplay, showThinking, runStreaming, runSucceeded, questionFormInteractive }} />;
});

function UserMessageRow({ message, renderAttachment }: Pick<MessageRowProps, 'message' | 'renderAttachment'>) {
  const t = useT();
  // Which attachment chip (if any) this row's preview modal is open for. Row-local, not
  // module-level: two attachments in the same message can never be "open" at once, but two
  // different messages opening their own attachments independently is fine and expected.
  // Previous/next steps through this message's images only.
  const gallery = useAttachmentGallery({ attachments: message.attachments ?? NO_ATTACHMENTS });
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
          {/* Images this browser still holds draw as thumbnails; everything else is a filename chip. */}
          {message.attachments.map((a) => (
            <SentAttachmentButton key={a.path} attachment={a} onOpen={gallery.open} renderAttachment={renderAttachment} />
          ))}
        </div>
      ) : null}
      <div className="jini-message-content">{message.content}</div>
      <div className="jini-message-actions jini-message-actions--user">
        <CopyMessageButton text={message.content} label={t('Copy message')} />
      </div>
      {gallery.opened ? (
        <AttachmentPreviewModal attachment={gallery.opened} onClose={gallery.close} navigation={gallery.navigation} />
      ) : null}
    </div>
  );
}

function AssistantMessageRow({
  message,
  usageSummary,
  showUsageTotal,
  showUsageLine,
  toolCallDisplay,
  showThinking,
  runStreaming,
  runSucceeded,
  questionFormInteractive,
  questionFormSubmittedAnswers,
  onQuestionFormSubmit,
  projectFileNames,
  onRequestOpenFile,
}: ResolvedMessageRowProps) {
  const registry = useExtEventRendererRegistry();
  const messageUsage = useMessageUsage({ message, ...(usageSummary === undefined ? {} : { summary: usageSummary }) });
  const timeline = useToolTimeline({ events: message.events }, { runStreaming, runSucceeded });
  const extGroups = useExtEventGroups({ events: message.events }, { slotOf: (name, data) => registry.slot({ name, data }) });
  const answeredCards = useAnsweredCards({ slotOf: registry.slot, events: message.events ?? [], groups: extGroups, runStreaming, runStatus: message.runStatus });

  const terminalNotice = terminalMessageNotice({ message }, {});
  const visibleContent = stripArtifact({ content: message.content });

  const displayBlocks = messageBlocks({ message, rows: timeline.rows, registry }, { toolCallDisplay, includeThinking: showThinking });
  // Artifact stripping trims/replaces text, invalidating the event offsets for rendering. Keep the
  // flat layout there; displayBlocks still supplies the recovery decision from the original events.
  const blocks = visibleContent === message.content ? displayBlocks : null;
  const pending = isPendingWithNoContent(message, visibleContent, timeline.rows.length);
  const runInProgress = isRunInProgress(message.runStatus);
  const awaitingAnswer = messageAwaitingAnswer({ runStreaming, runInProgress, events: message.events }, { isAnsweredCard: answeredCards.isAnsweredCard });
  const usage = usageLayout({ usage: messageUsage, interleaved: blocks !== null, runInProgress }, { runStreaming });
  const footerUsage = showUsageLine ? usage.footer : undefined;

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

  // Hidden mode reuses the same disclosure and card renderer for unrecovered failures.
  const renderTools = (rows: readonly ToolTimelineRow[], key?: string) => (toolCallDisplay !== 'show'
    ? <ToolCallGroup key={key} rows={rows} renderRow={renderToolCard} failureOnly={toolCallDisplay === 'hidden'} />
    : <div className="jini-message-tools" key={key}>{rows.map(renderToolCard)}</div>);
  const flatTools = flatToolGroups({ message, rows: timeline.rows, registry, displayBlocks }, { toolCallDisplay });

  const renderExtGroup = (group: ExtEventGroup) => {
    const renderer = registry.get({ name: group.name });
    if (!renderer && group.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME) return <MidRunUserMessage events={group.events} />;
    if (!renderer) return null;
    const answerText = answeredCards.answerText(group.slot);
    const node = renderer({
      name: group.name,
      events: group.events,
      runStreaming: answeredCards.runStreaming,
      runSucceeded,
      awaitingAnswer,
      runId: message.runId,
      ...(group.call === undefined ? {} : { call: group.call }),
      answered: answeredCards.isAnswered(group.slot),
      onAnswered: () => answeredCards.markAnswered(group.slot),
      onAnswerText: (text) => answeredCards.markAnswered(group.slot, text),
      ...(answeredCards.isRecorded(group.slot) ? { answerRecorded: true } : {}),
      ...(answerText === undefined ? {} : { answerText }),
    });
    if (!node) return null;
    return (
      // `key` includes the event count so a group that failed on an earlier, shorter event list
      // gets a fresh boundary instance (not the still-tripped one) once a new event actually
      // arrives for it, instead of staying tombstoned for the message's whole lifetime.
      <ExtEventErrorBoundary key={`${group.slot}:${group.events.length}`} name={group.name}>
        <div>{node}</div>
      </ExtEventErrorBoundary>
    );
  };

  const renderTextSegments = (text: string, keyPrefix: string): ReactNode =>
    splitOnQuestionForms({ input: text }).map((segment, i) =>
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

  const renderBlock = (block: AssistantBlock): ReactNode => {
    if (block.kind === 'text') {
      return <React.Fragment key={block.key}>{renderTextSegments(block.text, block.key)}</React.Fragment>;
    }
    if (block.kind === 'reply-end') {
      const reply = usage.replies[block.index];
      return reply && showUsageLine ? <UsageSummary key={block.key} usage={reply} showTotal={showUsageTotal} /> : null;
    }
    if (block.kind === 'tools') return renderTools(block.rows, block.key);
    if (block.kind === 'thinking') return <ThinkingBlock key={block.key} text={block.text} />;
    const group = extGroups.find((g) => g.slot === block.slot);
    if (!group) return null;
    return (
      <div className="jini-message-ext-events" key={block.key}>
        {renderExtGroup(group)}
      </div>
    );
  };

  return (
    <div
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
      {blocks
        ? blocks.map(renderBlock)
        : (
          <>
            {renderTextSegments(visibleContent, 'text')}
            {flatTools.map((group) => renderTools(group.rows, group.key))}
            {extGroups.length > 0 ? <div className="jini-message-ext-events">{extGroups.map(renderExtGroup)}</div> : null}
          </>
        )}
      <AssistantMessageFooter {...{ message, usageEvent: footerUsage, showUsageTotal, terminalNotice, pending, runInProgress, runStreaming, visibleContent, isAnsweredCard: answeredCards.isAnsweredCard }} />
    </div>
  );
}

/**
 * The live "what is it doing" line under a running reply (see `core/run-activity.ts`). Replaces the
 * old "Thinking…" placeholder, which vanished for good as soon as the first tool row appeared.
 * Kept a separate component so its one-second tick re-renders only this line, not the whole row.
 */
function RunActivityLine({ events, active, isAnsweredCard }: { events: AgentEvent[] | undefined; active: boolean; isAnsweredCard: IsAnsweredCard }) {
  const activityLabel = useRunActivity({ events: events, active: active }, { isAnsweredCard });
  const label = continuingRunNotice({ events, active }, {}) ?? activityLabel;
  if (label === null) return null;
  return (
    <div className="jini-message-pending jini-run-activity" aria-live="off">
      {label}
    </div>
  );
}
