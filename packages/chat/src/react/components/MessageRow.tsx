import { FolderChips } from './FolderChips.js';
import { projectAcceptedInputEvents } from '../../core/accepted-input.js';
import { MID_RUN_USER_MESSAGE_EXT_EVENT_NAME } from './MidRunUserMessage.js';
import { useSurfaceAnswerContexts } from './mcp-ui-question-input.js';
import { terminalMessageNotice, continuingRunNotice } from '../../core/durable-projection.js';
import type { ChatUsageSummary } from '../../core/turn-usage.js';
import { usageEndLabel, usageLayout, useMessageUsage, useUsageSummary } from './MessageRow.usage.js';
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
 * (`CopyMessageButton`), rendered inside a `.jini-message-actions` row.
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
import { assistantContentFromEvents, isAwaitingAnswer, isTerminalRunStatus, stripArtifact } from '../../core/index.js';
import { useToolTimeline, type ToolTimelineRow } from '../hooks/useToolTimeline.js';
import { useExtEventGroups, type ExtEventGroup } from '../hooks/useExtEventGroups.js';
import { useRunActivity } from '../hooks/useRunActivity.js';
import { useAnsweredCards } from '../hooks/useAnsweredCards.js';
import { interleaveMessageBlocks, splitMidRunBlocks, type MessageBlock } from '../message-blocks.js';
import { useT, useExtEventRendererRegistry } from '../hooks/context.js';
import type { ExtEventRendererRegistry } from '../ext-event-renderer-registry.js';
import { AttachmentPreviewModal } from './AttachmentPreviewModal.js';
import { SentAttachmentButton } from './SentAttachment.js';
import { useAttachmentGallery } from './AttachmentGallery.hooks.js';
import { CopyMessageButton } from './CopyMessageButton.js';
import { applyToolCallDisplay, toolRowsForDisplay, type ToolCallDisplay } from '../tool-call-display.js';
import { useAssistantMessageRenderers } from './MessageRow.hooks.js';

export interface MessageRowProps {
  message: ChatMessage;
  /** Conversation hosts show the first access status only; standalone rows retain it by default. */
  showAccessNotice?: boolean;
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
  /** Whether the server has yet to accept this reply's run (its user turn is still pending). */
  runSending?: boolean;
  /** Host-localized text shown verbatim only while this run is active and sending.
   * Omit to use the translated `Sending…` label. */
  sendingLabel?: string;
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

/** Hooks UsageSummary calls; defaults to the real ones, a test hands in fakes. */
export const defaultUsageSummaryHooks = { useT, useUsageSummary };
export type UsageSummaryHooks = typeof defaultUsageSummaryHooks;

/** One "Done · 6m 29s · $0.41 · total $2.50" line from reported usage, never estimated (the total is
 * left off when `showTotal` is false). Partial usage stays partial; output tokens are available to
 * assistive technology and in the tooltip. */
export function UsageSummary({ usage, showTotal, message, awaitingAnswer, hooks = defaultUsageSummaryHooks }: { usage: ChatUsageSummary; showTotal: boolean; message?: ChatMessage; awaitingAnswer?: boolean } & { hooks?: UsageSummaryHooks | undefined }) {
  const t = hooks.useT();
  const label = usageEndLabel({ usage, ...(message === undefined ? {} : { message }), ...(awaitingAnswer === undefined ? {} : { awaitingAnswer }) });
  const { text, title, ariaLabel } = hooks.useUsageSummary({ usage }, { showTotal, label });
  if (!text) return null;
  return (
    <div className="jini-message-usage" title={title} role="note" aria-label={ariaLabel}>
      {label === 'Done' ? <span className="jini-message-usage-dot" aria-hidden>●</span> : null}
      {t(label)} · {text}
    </div>
  );
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
/** A host status belongs to the run that emitted it, regardless of the current picker selection. */
function RunAccessNotice({ show, events, useTHook = useT }: { show: boolean; events: readonly AgentEvent[] | undefined } & { useTHook?: typeof useT }) {
  const t = useTHook();
  if (!show) return null;
  const notice = events?.find(event => event.kind === 'status' && event.label === 'full_cli_access');
  if (notice?.kind !== 'status' || !notice.detail) return null;
  return <div className="jini-chat-pane__notice" role="status">{t(notice.detail)}</div>;
}

export function ThinkingBlock({ text, useTHook = useT }: { text: string } & { useTHook?: typeof useT }) {
  const t = useTHook();
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

export function AssistantMessageFooter(
  { message, usageEvent, showUsageTotal, terminalNotice, pending, runInProgress, runStreaming, runSending, sendingLabel, visibleContent, isAnsweredCard, useTHook = useT }: {
    message: ChatMessage; usageEvent: ChatUsageSummary | undefined; showUsageTotal: boolean; terminalNotice: string | null;
    pending: boolean; runInProgress: boolean; runStreaming?: boolean; runSending: boolean; visibleContent: string; isAnsweredCard: IsAnsweredCard;
    sendingLabel: string | undefined;
  } & { useTHook?: typeof useT },
) {
  const t = useTHook();
  return <>
      {usageEvent ? <UsageSummary usage={usageEvent} showTotal={showUsageTotal} message={message}
        awaitingAnswer={isAwaitingAnswer({ events: message.events }, { isAnsweredCard })} /> : null}
      {terminalNotice ? <div className={message.runStatus === 'canceled' ? 'jini-chat-pane__notice' : 'jini-message-error'} role="status">{t(terminalNotice)}</div> : null}
      {!pending && !runInProgress ? (
        <div className="jini-message-actions jini-message-actions--assistant">
          <CopyMessageButton text={visibleContent} label={t('Copy message')} />
          {/* Extension seam: branch/thumbs-up/thumbs-down join here next, as siblings after copy,
              same .jini-message-action-btn ghost icon-button shape and fixed left-to-right order
              (copy, branch, thumbs-up, thumbs-down) — left unbuilt per this task's module doc
              above until their backends (conversation branching, feedback storage) exist. */}
        </div>
      ) : null}
      {runInProgress ? <RunActivityLine events={message.events} active={pending || (runStreaming === true && runInProgress)} isAnsweredCard={isAnsweredCard}
        sending={runSending} sendingLabel={sendingLabel} /> : null}
  </>;
}

/** Stable empty list for a message with no attachments. */
const NO_ATTACHMENTS: readonly ChatAttachment[] = [];

/** The display props `MessageRow` defaults, resolved — what `AssistantMessageRow` renders from. */
type ResolvedMessageRowProps = MessageRowProps
  & Required<Pick<MessageRowProps, 'showUsageTotal' | 'showUsageLine' | 'toolCallDisplay' | 'showThinking' | 'runStreaming' | 'runSending' | 'runSucceeded' | 'questionFormInteractive'>>;

type AssistantBlock = MessageBlock<ToolTimelineRow>;

/**
 * Memoized so a transcript re-render (a streaming update to the newest message, or a parent that
 * re-renders per composer keystroke) only re-renders rows whose props actually changed. Messages
 * are replaced, never mutated, so identity is a sound change signal.
 */
export const MessageRow = memo(function MessageRow({
  useSurfaceAnswerContextsHook = useSurfaceAnswerContexts, ...props
}: MessageRowProps & { useSurfaceAnswerContextsHook?: typeof useSurfaceAnswerContexts }) {
  const answerContexts = useSurfaceAnswerContextsHook({ events: props.message.events });
  const message = useMemo(() => props.message.events === undefined ? props.message : {
    ...props.message, events: projectAcceptedInputEvents({ events: props.message.events }, answerContexts),
  }, [props.message, answerContexts]);
  if (message.role === 'user') return <UserMessageRow {...props} message={message} />;
  return <AssistantMessageRow {...resolveDisplayProps(props)} message={message} />;
});

/** `MessageRow`'s display props with their defaults applied, ready for `AssistantMessageRow`. */
function resolveDisplayProps(props: MessageRowProps, _options = {}): ResolvedMessageRowProps {
  const {
    showUsageTotal = true,
    showUsageLine = true,
    toolCallDisplay = 'show',
    showThinking = false,
    runStreaming = false,
    runSending = false,
    runSucceeded = false,
    questionFormInteractive = false,
  } = props;
  return { ...props, showUsageTotal, showUsageLine, toolCallDisplay, showThinking, runStreaming, runSending, runSucceeded, questionFormInteractive };
}

/** Hooks UserMessageRow calls; defaults to the real ones, a test hands in fakes. */
const defaultUserMessageRowHooks = { useT, useAttachmentGallery };
type UserMessageRowHooks = typeof defaultUserMessageRowHooks;

function UserMessageRow({ message, renderAttachment, hooks = defaultUserMessageRowHooks }: Pick<MessageRowProps, 'message' | 'renderAttachment'> & { hooks?: UserMessageRowHooks | undefined }) {
  const t = hooks.useT();
  // Which attachment chip (if any) this row's preview modal is open for. Row-local, not
  // module-level: two attachments in the same message can never be "open" at once, but two
  // different messages opening their own attachments independently is fine and expected.
  // Previous/next steps through this message's images only.
  const gallery = hooks.useAttachmentGallery({ attachments: message.attachments ?? NO_ATTACHMENTS });
  return (
    <div
      className="jini-message jini-message-user"
      data-message-id={message.id}
      data-agent-element={`chat-message-${message.id}`}
      data-agent-role="region"
      data-agent-label="A message from the user"
    >
      {(message.attachments?.length || message.folders?.length) ? (
        <div className="jini-message-attachments">
          {/* Images this browser still holds draw as thumbnails; everything else is a filename chip. */}
          <FolderChips folders={message.folders} />
          {(message.attachments ?? []).map((a) => (
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

// A validated extension may already show the explanation. Keep the generic fallback when its
// renderer is absent or refuses the payload, so malformed history never hides a failed turn.
function assistantTerminalNotice({ message, runStreaming, runSucceeded, extGroups, registry }: {
  message: ChatMessage; runStreaming?: boolean; runSucceeded?: boolean;
  extGroups: readonly ExtEventGroup[]; registry: ExtEventRendererRegistry;
}, _options = {}) {
  const extensionExplainsFailure = !runStreaming && !runSucceeded && extGroups.some(group => registry.hasTerminalNotice(group));
  return extensionExplainsFailure ? null : terminalMessageNotice({ message }, {});
}

/** Only a completed reply without footer usage can own the final inline usage label. */
function lastFinishedReplyIndex({ runInProgress, usage }: {
  runInProgress: boolean; usage: ReturnType<typeof usageLayout>;
}, _options = {}) {
  return !runInProgress && !usage.footer ? usage.replies.findLastIndex(value => value !== undefined) : -1;
}

/** Hooks AssistantMessageRow calls; defaults to the real ones, a test hands in fakes. */
const defaultAssistantMessageRowHooks = { useExtEventRendererRegistry, useMessageUsage, useToolTimeline, useExtEventGroups, useAnsweredCards, useAssistantMessageRenderers };
type AssistantMessageRowHooks = typeof defaultAssistantMessageRowHooks;

function AssistantMessageRow({
  showAccessNotice = true,
  message,
  usageSummary,
  showUsageTotal,
  showUsageLine,
  toolCallDisplay,
  showThinking,
  runStreaming,
  runSending,
  sendingLabel,
  runSucceeded,
  questionFormInteractive,
  questionFormSubmittedAnswers,
  onQuestionFormSubmit,
  projectFileNames,
  onRequestOpenFile, hooks = defaultAssistantMessageRowHooks,
}: ResolvedMessageRowProps & { hooks?: AssistantMessageRowHooks | undefined }) {
  const registry = hooks.useExtEventRendererRegistry();
  const messageUsage = hooks.useMessageUsage({ message, ...(usageSummary === undefined ? {} : { summary: usageSummary }) });
  const timeline = hooks.useToolTimeline({ events: message.events }, { runStreaming, runSucceeded });
  const extGroups = hooks.useExtEventGroups({ events: message.events }, { slotOf: (name, data) => registry.slot({ name, data }) });
  const answeredCards = hooks.useAnsweredCards({ slotOf: registry.slot, events: message.events ?? [], groups: extGroups, runStreaming, runStatus: message.runStatus });

  const terminalNotice = assistantTerminalNotice({ message, runStreaming, runSucceeded, extGroups, registry });
  const visibleContent = stripArtifact({ content: message.content });

  const displayBlocks = messageBlocks({ message, rows: timeline.rows, registry }, { toolCallDisplay, includeThinking: showThinking });
  // Artifact stripping trims/replaces text, invalidating the event offsets for rendering. Keep the
  // flat layout there; displayBlocks still supplies the recovery decision from the original events.
  const blocks = visibleContent === message.content ? displayBlocks : null;
  const pending = isPendingWithNoContent(message, visibleContent, timeline.rows.length);
  const runInProgress = isRunInProgress(message.runStatus);
  const awaitingAnswer = messageAwaitingAnswer({ runStreaming, runInProgress, events: message.events }, { isAnsweredCard: answeredCards.isAnsweredCard });
  const usage = usageLayout({ usage: messageUsage, interleaved: blocks !== null, runInProgress }, {
    runStreaming: runStreaming && !isTerminalRunStatus({ status: message.runStatus }),
  });
  const footerUsage = showUsageLine ? usage.footer : undefined;
  const lastFinishedReply = lastFinishedReplyIndex({ runInProgress, usage });

  const flatTools = flatToolGroups({ message, rows: timeline.rows, registry, displayBlocks }, { toolCallDisplay });
  const flatExtGroups = extGroups.filter(group => group.name !== MID_RUN_USER_MESSAGE_EXT_EVENT_NAME);
  const { renderBlock, renderExtGroup, renderAssistantSection } = hooks.useAssistantMessageRenderers({
    message, rows: timeline.rows, runStreaming, runSucceeded, projectFileNames, onRequestOpenFile,
    toolCallDisplay, registry, answeredCards, runInProgress, awaitingAnswer, questionFormInteractive,
    questionFormSubmittedAnswers, onQuestionFormSubmit, usage, showUsageLine, showUsageTotal,
    lastFinishedReply, extGroups, footerUsage, terminalNotice, pending, runSending, sendingLabel,
    visibleContent, flatTools, flatExtGroups, UsageSummary, ThinkingBlock, AssistantMessageFooter,
  });
  // The lossless fallback keeps the host's text intact; user receipts still own separate rows,
  // in their original receipt order, outside the assistant's actions and usage footer.
  // Keep the same child-array nesting as the interleaved path so React preserves the footer.
  if (blocks === null) return <>
    <RunAccessNotice show={showAccessNotice} events={message.events} />
    {[renderAssistantSection({ section: null, key: message.id, footer: true })]}
    {extGroups.filter(group => group.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME).map(renderExtGroup)}
  </>;
  // A reply boundary without reported usage renders nothing; it must not create an empty row's gap.
  const visibleBlocks = blocks.filter(block => block.kind !== 'reply-end' || (showUsageLine && usage.replies[block.index] !== undefined));
  const { sections, footerIndex } = transcriptSections({ blocks: visibleBlocks, runInProgress });
  return <><RunAccessNotice show={showAccessNotice} events={message.events} />{sections.map((section, index) => isUserSection({ section })
    ? <React.Fragment key={section[0]!.key}>{section.map(renderBlock)}</React.Fragment>
    : renderAssistantSection({ section, key: section[0]?.key ?? message.id, footer: index === footerIndex }))}</>;
}

/** Place the one footer on the last assistant section, never below a completed trailing input. */
function transcriptSections({ blocks, runInProgress }: {
  blocks: readonly AssistantBlock[]; runInProgress: boolean;
}, _options = {}) {
  const sections = splitMidRunBlocks({ blocks });
  if (sections.length === 0) sections.push([]);
  // A live trailing input starts the next reply. A completed run needs no empty assistant row
  // (its actions/usage used to leave a large gap below the final user bubble).
  if (runInProgress && isUserSection({ section: sections.at(-1) })) sections.push([]);
  const footerIndex = sections.findLastIndex(section => !isUserSection({ section }));
  return { sections, footerIndex };
}

/** A user receipt occupies its own section; every other block belongs to an assistant row. */
function isUserSection({ section }: { section: readonly AssistantBlock[] | undefined }, _options = {}): boolean {
  const block = section?.[0];
  return block?.kind === 'ext' && block.name === MID_RUN_USER_MESSAGE_EXT_EVENT_NAME;
}

/** Hooks RunActivityLine calls; defaults to the real ones, a test hands in fakes. */
const defaultRunActivityLineHooks = { useT, useRunActivity };
type RunActivityLineHooks = typeof defaultRunActivityLineHooks;

/**
 * The live "what is it doing" line under a running reply (see `core/run-activity.ts`). Replaces the
 * old "Thinking…" placeholder, which vanished for good as soon as the first tool row appeared.
 * Kept a separate component so its one-second tick re-renders only this line, not the whole row.
 * A host's already-localized sending label is used verbatim until acceptance.
 */
function RunActivityLine({ events, active, isAnsweredCard, sending, sendingLabel, hooks = defaultRunActivityLineHooks }: { events: AgentEvent[] | undefined; active: boolean; isAnsweredCard: IsAnsweredCard; sending: boolean; sendingLabel: string | undefined } & { hooks?: RunActivityLineHooks | undefined }) {
  const t = hooks.useT();
  const activityLabel = hooks.useRunActivity({ events: events, active: active }, { isAnsweredCard });
  // Until the server accepts the start the turn is still on its way: "Thinking…" there read as the
  // model working while the text had not even arrived (owner, 2026-10-27). No timeout.
  const label = active && sending ? sendingLabel ?? t('Sending…') : continuingRunNotice({ events, active }, {}) ?? activityLabel;
  if (label === null) return null;
  return (
    <div className="jini-message-pending jini-run-activity" aria-live="off">
      {label}
    </div>
  );
}
