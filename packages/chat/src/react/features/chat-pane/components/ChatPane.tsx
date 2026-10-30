type WorkingDirectoryControlPlacement = 'below' | 'composer' | 'none';

import { AgentPluginUsage } from './AgentPluginUsage.js';
import { SECRET_REDACTED_NOTICE } from '../../../../core/user-text-redaction.js';
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { WorkingDirPicker } from '@jini-ai/ui';

import { Composer } from '../../../components/Composer.js';
import { appendComposerDiscovery } from '../../../components/composer-discovery.js';
import { MessageList } from '../../../components/MessageList.js';
import { useT } from '../../../hooks/context.js';
import type { ComposerSlots } from '../../../slots.js';
import { definedProps } from '../../../util/defined-props.js';
import type {
  ChatPaneAgent,
  ChatPaneProps,
  ChatPaneRuntimeAccess,
  ChatPaneVariant,
  ChatPaneWorkingDirectoryAccess,
  TypedAnswerNotice,
} from '../types.js';
import { describeChatPaneSendBlocker, describeTypedAnswerNotice, isChatPaneApiModeConfigured, isChatPaneFileDropEnabled } from '../rules.js';
import { useChatPane, type UseChatPaneResult } from '../hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../hooks/useChatPaneAgentControl.hooks.js';
import { useChatPaneComposerPlaceholder } from '../hooks/useChatPaneComposerPlaceholder.hooks.js';
import { useChatPaneControlsHeight } from '../hooks/useChatPaneControlsHeight.hooks.js';
import { useChatPaneNewTabLinks } from '../hooks/useChatPaneNewTabLinks.hooks.js';
import { useChatPaneSurface } from '../hooks/useChatPaneSurface.hooks.js';
import { useChatPaneSuggestion } from '../hooks/useChatPaneSuggestion.hooks.js';
import {
  useChatPaneFileDrop,
  type ChatPaneFileDropTargetProps,
  type UseChatPaneFileDropResult,
} from '../hooks/useChatPaneFileDrop.hooks.js';
import {
  useChatPaneRuntimeInventory,
  type UseChatPaneRuntimeInventoryResult,
} from '../hooks/useChatPaneRuntimeInventory.hooks.js';
import { CHAT_PANE_STYLES } from '../styles.js';
import { AgentRuntimePicker } from './AgentRuntimePicker.js';

const EMPTY_AGENTS: NonNullable<ChatPaneProps['agents']> = [];

function defaultHeader(
  title: string | undefined,
  onReset: () => void,
  t: (key: string) => string,
): ReactNode {
  return (
    <div className="jini-chat-pane__header">
      <div className="jini-chat-pane__heading">
        <span className="jini-chat-pane__eyebrow">{t('Workspace chat')}</span>
        <h1 className="jini-chat-pane__title">{title ?? t('Chat')}</h1>
      </div>
      <button type="button" className="jini-chat-pane__new-thread" onClick={onReset}>
        {t('New thread')}
      </button>
    </div>
  );
}

function chatPaneClassName(variant: ChatPaneVariant, className: string | undefined): string {
  const suffix = className ? ' ' + className : '';
  return `jini-chat-pane jini-chat-pane--${variant}${suffix}`;
}

/** What the view needs after collapsing the four `runtimeAccess === undefined ? host : inventory`
 * ternaries into a single branch. */
interface ChatPaneRuntimeView {
  agents: readonly ChatPaneAgent[];
  scanningAgents: boolean;
  /** No successful inventory answer yet and the last attempt failed — see
   *  `UseChatPaneRuntimeInventoryResult.connectingAgents`. Always `false` for injected agents. */
  connectingAgents: boolean;
  daemonOnline: boolean;
  rescanAgents: (() => void) | undefined;
}

function resolveRuntimeAccessView(
  runtimeAccess: ChatPaneRuntimeAccess | undefined,
  injectedAgents: readonly ChatPaneAgent[],
  scanningAgents: boolean,
  daemonOnline: boolean,
  onRescanAgents: (() => void) | undefined,
  inventory: UseChatPaneRuntimeInventoryResult,
): ChatPaneRuntimeView {
  if (runtimeAccess === undefined) {
    return { agents: injectedAgents, scanningAgents, connectingAgents: false, daemonOnline, rescanAgents: onRescanAgents };
  }
  return {
    agents: inventory.agents,
    scanningAgents: inventory.scanningAgents,
    connectingAgents: inventory.connectingAgents,
    daemonOnline: inventory.daemonOnline,
    rescanAgents: () => void inventory.rescanAgents(),
  };
}

interface ChatPaneSuggestionsRowProps {
  suggestions: readonly string[];
  onSelect: (suggestion: string) => void;
  t: (key: string) => string;
}

function ChatPaneSuggestionsRow({ suggestions, onSelect, t }: ChatPaneSuggestionsRowProps): ReactNode {
  if (suggestions.length === 0) return null;
  return (
    <div className="jini-chat-pane__suggestions" aria-label={t('Example prompts')}>
      {suggestions.map((suggestion) => (
        <button
          type="button"
          className="jini-chat-pane__suggestion"
          key={suggestion}
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

/**
 * The `unavailable` banner's copy and, where reachable, its actual fix — distinguishing three
 * CLI-less states so a pointer at BYOK is never shown as an option that would not actually help:
 *
 * - `executionMode === 'local'` with BYOK available: switching mode is a real fix. When the host
 *   wired `onExecutionModeChange` (the same callback the runtime picker's own mode buttons already
 *   call — see `AgentRuntimePicker.tsx`), this renders as a button that performs the switch
 *   directly rather than prose telling the operator to go hunting for the control themselves. A
 *   host that reports `apiModeAvailable` without wiring the callback still gets an honest, if
 *   inert, pointer as plain copy.
 * - `executionMode === 'local'` with BYOK NOT available: switching would not help — offering it
 *   anyway would be a lie — so this falls back to the original, unconditional message.
 * - `executionMode === 'api'` already: the operator is already on the one path that could work,
 *   so a "switch to BYOK" pointer would be nonsensical here; whatever is still missing (e.g. no
 *   model chosen) is `RuntimeByokDetails`' own job to explain inside the runtime picker, not this
 *   banner's.
 */
function ChatPaneNoUsableCliMessage({
  executionMode,
  apiModeAvailable,
  onExecutionModeChange,
  t,
}: {
  executionMode: 'local' | 'api';
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  t: (key: string) => string;
}): ReactNode {
  const byokIsARealFix = executionMode === 'local' && apiModeAvailable;
  if (!byokIsARealFix) {
    return <div className="jini-chat-pane__error" role="alert">{t('No usable CLI is selected.')}</div>;
  }
  if (!onExecutionModeChange) {
    return (
      <div className="jini-chat-pane__error" role="alert">
        {t('No usable CLI is selected — switch to BYOK to use your own API key.')}
      </div>
    );
  }
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t('No usable CLI is selected.')}{' '}
      <button
        type="button"
        className="jini-chat-pane__error-action"
        onClick={() => onExecutionModeChange('api')}
      >
        {t('Switch to BYOK')}
      </button>
    </div>
  );
}

interface ChatPaneAvailabilityStatusProps {
  unavailable: boolean;
  scanningAgents: boolean;
  connectingAgents: boolean;
  executionMode: 'local' | 'api';
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  t: (key: string) => string;
}

/**
 * `unavailable` alone conflates "inventory still loading" with "inventory loaded, nothing
 * usable" — both present as `selectedAgent === undefined`. `scanningAgents` is the signal
 * that tells them apart, mirroring the `workingDirectoryPending`/`workingDirectoryInvalid`
 * pair below: a pending detection is a `status`, only a *finished* detection that found
 * nothing is an `alert`. `connectingAgents` is a third state: the inventory could not be
 * read at all (the host is unreachable, typically a daemon restart) and a retry is
 * pending — a plain status too, never "No usable CLI", which only a SUCCESSFUL answer can
 * establish.
 */
function ChatPaneAvailabilityStatus({
  unavailable,
  scanningAgents,
  connectingAgents,
  executionMode,
  apiModeAvailable,
  onExecutionModeChange,
  t,
}: ChatPaneAvailabilityStatusProps): ReactNode {
  if (!unavailable) return null;
  if (connectingAgents) {
    return (
      <div className="jini-chat-pane__status" role="status">
        {t('Connecting to the assistant…')}
      </div>
    );
  }
  if (scanningAgents) {
    return (
      <div className="jini-chat-pane__status" role="status">
        {t('Loading available CLIs')}
      </div>
    );
  }
  return (
    <ChatPaneNoUsableCliMessage
      executionMode={executionMode}
      apiModeAvailable={apiModeAvailable}
      onExecutionModeChange={onExecutionModeChange}
      t={t}
    />
  );
}

function ChatPaneWorkingDirectoryStatus({
  workingDirectoryPending,
  workingDirectoryInvalid,
  t,
}: {
  workingDirectoryPending: boolean;
  workingDirectoryInvalid: boolean;
  t: (key: string) => string;
}): ReactNode {
  if (workingDirectoryPending) {
    return (
      <div className="jini-chat-pane__status" role="status">
        {t('Checking working directory…')}
      </div>
    );
  }
  if (!workingDirectoryInvalid) return null;
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t('Working directory is unavailable.')}
    </div>
  );
}

/**
 * The typed-answer delivery notice. Only `'failed'` ever reaches it: `useChatPane` queues a
 * `'not-pending'` refusal as one ordinary message itself (`answerWaitingQuestion`), without a notice.
 *
 * MOVE (from the retired "Send as a new message" button this notice once rendered for
 * `'not-pending'`): the held answer's only way into a new run besides clearing the draft — an
 * explicit choice, so a closed question never turns an answer into a paid run on a second Enter.
 * The hook's automatic one-time fallback now owns that guarantee, which left the button unreachable.
 */
function ChatPaneTypedAnswerNotice({
  typedAnswerNotice,
  t,
}: {
  typedAnswerNotice: TypedAnswerNotice | null;
  t: (key: string) => string;
}): ReactNode {
  if (!typedAnswerNotice) return null;
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t(describeTypedAnswerNotice({ notice: typedAnswerNotice }))}
    </div>
  );
}

/** A send the server never accepted. Its text went back into the composer if that was still empty;
 * Retry sends it again either way (see `useChatPane`'s `retrySend`). */
function ChatPaneSendError({ sendError, onRetry, t }: { sendError: Error | null; onRetry: () => void; t: (key: string) => string }): ReactNode {
  if (!sendError) return null;
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t('Not sent:')} {sendError.message}{' '}
      <button type="button" className="jini-chat-pane__error-action" onClick={onRetry}>{t('Retry')}</button>
    </div>
  );
}

interface ChatPaneStatusMessagesProps extends ChatPaneAvailabilityStatusProps {
  sendError: Error | null;
  onRetrySend: () => void;
  attachmentError: Error | null;
  dropReadError: string | null;
  workingDirectoryError: Error | null;
  workingDirectoryPending: boolean;
  workingDirectoryInvalid: boolean;
  runtimeInventoryError: Error | null;
  typedAnswerNotice: TypedAnswerNotice | null;
}

/** The pane's stack of mutually-independent error/status banners — each condition is its own
 * source of truth, so they are rendered as siblings rather than folded into one derived state. */
function ChatPaneStatusMessages({
  sendError,
  onRetrySend,
  attachmentError,
  dropReadError,
  workingDirectoryError,
  workingDirectoryPending,
  workingDirectoryInvalid,
  runtimeInventoryError,
  typedAnswerNotice,
  ...availability
}: ChatPaneStatusMessagesProps): ReactNode {
  const { t } = availability;
  return (
    <>
      <ChatPaneAvailabilityStatus {...availability} />
      <ChatPaneSendError sendError={sendError} onRetry={onRetrySend} t={t} />
      {/* Run failures render once on their assistant message; pane banners remain for
          attachment, working-directory and other errors that have no message binding. */}
      {attachmentError ? (
        <div className="jini-chat-pane__error" role="alert">{attachmentError.message}</div>
      ) : null}
      {dropReadError ? (
        <div className="jini-chat-pane__error" role="alert">{dropReadError}</div>
      ) : null}
      {workingDirectoryError ? (
        <div className="jini-chat-pane__error" role="alert">{workingDirectoryError.message}</div>
      ) : null}
      <ChatPaneWorkingDirectoryStatus
        workingDirectoryPending={workingDirectoryPending}
        workingDirectoryInvalid={workingDirectoryInvalid}
        t={t}
      />
      {/* While connecting, the transport error is transient noise the retry is already handling. */}
      {runtimeInventoryError && !availability.connectingAgents ? (
        <div className="jini-chat-pane__error" role="alert">
          {runtimeInventoryError.message}
        </div>
      ) : null}
      <ChatPaneTypedAnswerNotice typedAnswerNotice={typedAnswerNotice} t={t} />
    </>
  );
}

interface ChatPaneWorkingDirectoryBlockProps {
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined;
  workingDirectoryControlPlacement: WorkingDirectoryControlPlacement;
  pane: UseChatPaneResult;
  t: (key: string) => string;
}

function ChatPaneWorkingDirectoryBlock({
  workingDirectoryAccess,
  workingDirectoryControlPlacement,
  pane,
  t,
}: ChatPaneWorkingDirectoryBlockProps): ReactNode {
  if (workingDirectoryAccess && workingDirectoryControlPlacement === 'below') {
    return (
      <div className="jini-chat-pane__workdir">
        <WorkingDirPicker
          workingDir={pane.workingDirectory}
          recentDirs={[...pane.recentDirectories]}
          onPickDirectory={() => void pane.pickWorkingDirectory()}
          onSelectRecent={(directory) => void pane.selectRecentDirectory(directory)}
          placement="up"
          onClear={pane.clearWorkingDirectory}
          invalid={pane.workingDirectoryInvalid}
          onOpen={() => void pane.openWorkingDirectoryPicker()}
          labels={{ trigger: t('Select working directory') }}
        />
      </div>
    );
  }
  // Three cases render nothing here, for different reasons:
  // - No native `workingDirectoryAccess`: the static text line this replaced is gone entirely —
  //   see `ChatPaneComposerArea` below, which threads `pane.workingDirectory` and
  //   `pane.selectRecentDirectory` into `Composer`'s own folder-icon (popover) trigger instead.
  // - `workingDirectoryAccess` present but `workingDirectoryControlPlacement === 'composer'`: the
  //   host asked for the control next to "+" instead — `resolveComposerWorkingDirectory` wires
  //   `Composer`'s trigger straight to `pane.pickWorkingDirectory` in that case, so rendering this
  //   block too would put up a second, competing control below the composer.
  // - `workingDirectoryControlPlacement === 'none'`: the host asked for no working-directory
  //   control anywhere — `resolveComposerWorkingDirectory` supplies neither composer handler in
  //   this case either, so `Composer`'s own folder-icon gate (`onChangeWorkingDirectory ||
  //   onPickWorkingDirectory`) renders nothing too. Nothing here has a trigger to defer to.
  // In every case but `'none'`, the trigger this defers to already covers both "nothing set yet"
  // and "a value is set", so this block has nothing left to render.
  return null;
}

/** `uploadAttachments === undefined` gates BOTH of these — a temporarily-disabled composer still
 * consumes a file drop so the browser cannot navigate away to the local file (see
 * `useChatPaneFileDrop`'s module doc), so the drop handlers stay attached even when the picker
 * itself is hidden. Shared here so `ChatPaneComposerArea` pays for the branch once, at module
 * scope, instead of per call site. */
function resolveDropTargetProps(
  uploadAttachments: ChatPaneProps['uploadAttachments'],
  fileDrop: UseChatPaneFileDropResult,
): ChatPaneFileDropTargetProps | Record<string, never> {
  return uploadAttachments === undefined ? {} : fileDrop.targetProps;
}

function resolveComposerAttachmentPicker(
  uploadAttachments: ChatPaneProps['uploadAttachments'],
  pane: UseChatPaneResult,
  attachmentAccept: ChatPaneProps['attachmentAccept'],
): { attachmentPicker?: { onFiles: (files: File[]) => void; uploading: boolean; accept?: string } } {
  if (uploadAttachments === undefined) return {};
  return {
    attachmentPicker: definedProps({ source: {
      onFiles: pane.addAttachments,
      uploading: pane.isUploadingAttachments,
      accept: attachmentAccept,
    } }),
  };
}

/**
 * Resolves which of `Composer`'s two mutually-exclusive working-directory props (if either) this
 * render should supply, mirroring `ChatPaneWorkingDirectoryBlock`'s own four-way branch above so
 * the two never disagree about which control owns the composer's folder-icon slot:
 *
 * - `workingDirectoryControlPlacement === 'none'`: neither prop, regardless of whether
 *   `workingDirectoryAccess` is present — the host asked for no working-directory control
 *   anywhere, so `Composer`'s own gate (`onChangeWorkingDirectory || onPickWorkingDirectory`)
 *   renders nothing. Checked first because it overrides both cases below.
 * - No `workingDirectoryAccess`: the composer's lightweight text-input popover, via
 *   `onChangeWorkingDirectory`. `pane.selectRecentDirectory` is reused as the plain setter here
 *   rather than inventing one — `useChatPaneWorkingDirectory`'s own doc confirms it already writes
 *   the value directly (no native validation) whenever `access` is absent, which is exactly this
 *   case.
 * - `workingDirectoryAccess` present and `workingDirectoryControlPlacement === 'composer'`: the
 *   SAME folder-icon trigger, but wired to `onPickWorkingDirectory` instead — clicking it invokes
 *   the native OS dialog (`pane.pickWorkingDirectory`) directly, with no popover in between.
 * - `workingDirectoryAccess` present and placement is (default) `'below'`: neither prop — the
 *   composer renders no folder icon at all, and `ChatPaneWorkingDirectoryBlock` renders the richer
 *   `WorkingDirPicker` below instead, unchanged from every host's prior behavior.
 */
function resolveComposerWorkingDirectory(
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined,
  workingDirectoryControlPlacement: 'below' | 'composer' | 'none',
  pane: UseChatPaneResult,
): {
  workingDirectory?: string | null;
  onChangeWorkingDirectory?: (workingDirectory: string) => void;
  onPickWorkingDirectory?: () => void;
} {
  if (workingDirectoryControlPlacement === 'none') {
    return {};
  }
  if (!workingDirectoryAccess) {
    return {
      workingDirectory: pane.workingDirectory,
      onChangeWorkingDirectory: (directory: string) => void pane.selectRecentDirectory(directory),
    };
  }
  if (workingDirectoryControlPlacement === 'composer') {
    return {
      workingDirectory: pane.workingDirectory,
      onPickWorkingDirectory: () => void pane.pickWorkingDirectory(),
    };
  }
  return {};
}

interface ChatPaneComposerAreaProps {
  fileDrop: UseChatPaneFileDropResult;
  uploadAttachments: ChatPaneProps['uploadAttachments'];
  pane: UseChatPaneResult;
  disabled: boolean;
  unavailable: boolean;
  placeholder: string | undefined;
  slots: ComposerSlots;
  attachmentAccept: ChatPaneProps['attachmentAccept'];
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined;
  workingDirectoryControlPlacement: WorkingDirectoryControlPlacement;
  t: (key: string) => string;
}

/** The drop target, composer, and working-directory block — everything below the status banners
 * that reads/writes the live pane. Cancelling an in-flight run is not a separate control here: it
 * lives in the composer's own trailing button, which swaps from send to stop while streaming (see
 * `Composer`'s `running`/`onCancel` props) — the same control an operator's attention is already
 * on, rather than a second affordance elsewhere in the pane they'd have to go find.
 *
 * The pending-turn strip previously lived here (a banner bolted above the composer). It now
 * renders inside `<MessageList>` itself, as the newest transcript entry — see that component's
 * `pendingPrompts` prop and this component's own call site below. */
function ChatPaneComposerArea({
  fileDrop,
  uploadAttachments,
  pane,
  disabled,
  unavailable,
  placeholder,
  slots,
  attachmentAccept,
  workingDirectoryAccess,
  workingDirectoryControlPlacement,
  t,
}: ChatPaneComposerAreaProps): ReactNode {
  const sendDisabledReasonId = useId();
  const sendDisabledReason = pane.sendBlocker && pane.sendBlocker !== 'streaming'
    ? t(describeChatPaneSendBlocker(pane.sendBlocker))
    : undefined;
  return (
    <div
      className={`jini-chat-pane__drop-target${fileDrop.draggingFiles ? ' is-dragging-files' : ''}`}
      data-testid="chat-pane-file-drop-target"
      data-dragging-files={fileDrop.draggingFiles ? 'true' : 'false'}
      {...resolveDropTargetProps(uploadAttachments, fileDrop)}
    >
      {fileDrop.draggingFiles ? (
        <span className="jini-chat-pane__drop-announcement" role="status">
          {t('Drop files to attach')}
        </span>
      ) : null}
      <Composer
        composer={pane.composer}
        onSend={() => void pane.send()}
        // Streaming no longer locks the textarea: `pane.send()` queues a turn typed during a run
        // rather than refusing it, so the operator can keep writing while the agent thinks.
        disabled={disabled || unavailable}
        // The one blocker `send()` handles itself. Every other refusal still greys out the button.
        sendDisabled={!pane.canSend && pane.sendBlocker !== 'streaming'}
        {...definedProps({ source: { sendDisabledReason, sendDisabledReasonId: sendDisabledReason ? sendDisabledReasonId : undefined } })}
        running={pane.conversation.isStreaming}
        onCancel={pane.conversation.cancel}
        onInterrupt={pane.interruptSend}
        {...definedProps({ source: { placeholder } })}
        slots={{ ...slots, footerAccessories: <>
          {sendDisabledReason ? <small id={sendDisabledReasonId} className="jini-composer-send-blocker">{sendDisabledReason}</small> : null}
          {slots.footerAccessories}
        </> }}
        {...resolveComposerAttachmentPicker(uploadAttachments, pane, attachmentAccept)}
        {...resolveComposerWorkingDirectory(workingDirectoryAccess, workingDirectoryControlPlacement, pane)}
      />
      <ChatPaneWorkingDirectoryBlock
        workingDirectoryAccess={workingDirectoryAccess}
        workingDirectoryControlPlacement={workingDirectoryControlPlacement}
        pane={pane}
        t={t}
      />
    </div>
  );
}

/** Every prop `ChatPane` defaults, and its default — applied only where the caller left the prop
 * `undefined`, exactly like the destructuring defaults this replaced. */
type ChatPaneDefaultedProp =
  | 'agents' | 'runtimeStatusPollMs' | 'variant' | 'scanningAgents' | 'daemonOnline' | 'executionMode'
  | 'apiModeAvailable' | 'suggestions' | 'workingDirectoryControlPlacement' | 'toolCallDisplay'
  | 'showUsageLine' | 'showThinking' | 'agentPluginsMode' | 'disabled' | 'runtimePickerPlacement';

type ResolvedChatPaneProps = ChatPaneProps & Required<Pick<ChatPaneProps, ChatPaneDefaultedProp>>;

const EMPTY_SUGGESTIONS: readonly string[] = [];

const CHAT_PANE_DEFAULTS: Required<Pick<ChatPaneProps, ChatPaneDefaultedProp>> = {
  agents: EMPTY_AGENTS,
  runtimeStatusPollMs: 5_000,
  variant: 'workspace',
  scanningAgents: false,
  daemonOnline: true,
  executionMode: 'local',
  apiModeAvailable: false,
  suggestions: EMPTY_SUGGESTIONS,
  workingDirectoryControlPlacement: 'below',
  toolCallDisplay: 'show',
  showUsageLine: true,
  showThinking: false,
  agentPluginsMode: 'auto',
  disabled: false,
  runtimePickerPlacement: 'up',
};

function applyChatPaneDefaults(props: ChatPaneProps): ResolvedChatPaneProps {
  const resolved: ResolvedChatPaneProps = { ...props, ...CHAT_PANE_DEFAULTS };
  for (const key of Object.keys(CHAT_PANE_DEFAULTS) as ChatPaneDefaultedProp[]) {
    if (props[key] !== undefined) Object.assign(resolved, { [key]: props[key] });
  }
  return resolved;
}

function resolveAgentControlOptions(agentControl: ChatPaneProps['agentControl']) {
  return definedProps({ source: {
    enabled: agentControl?.enabled ?? false,
    bridgeAccess: agentControl?.bridgeAccess,
    webmcp: agentControl?.webmcp,
  } });
}

function useComposerHandlePublisher(
  { pane }: { pane: UseChatPaneResult },
  { composerHandle }: { composerHandle?: ChatPaneProps['composerHandle'] },
): void {
  // Mirrors `Composer.tsx`'s own `draftRef`: `composerHandle.insertText` (below) is called from
  // OUTSIDE any render, so it cannot close over `pane.composer.draft` directly — that would freeze
  // it at whatever the draft was on the render that captured it. Reassigned unconditionally every
  // render, same as its counterpart.
  const composerDraftRef = useRef(pane.composer.draft);
  composerDraftRef.current = pane.composer.draft;
  useEffect(() => {
    if (!composerHandle) return undefined;
    composerHandle.current = {
      insertText: (text) => {
        pane.composer.setDraft(appendComposerDiscovery({ draft: composerDraftRef.current, insertText: text }));
      },
    };
    return () => {
      composerHandle.current = null;
    };
    // `pane.composer` is a fresh object every render `useComposer` produces (see its own `useMemo`
    // deps), so depending on it here just means this effect re-publishes a new (equally correct)
    // closure on every render rather than genuinely skipping renders — cheap, and it keeps
    // `pane.composer.setDraft` from ever going stale if that reference ever changes.
  }, [composerHandle, pane.composer]);
}

function useChatPaneTranscriptProps(
  { pane }: { pane: UseChatPaneResult },
  { projectFileNames }: { projectFileNames?: ChatPaneProps['projectFileNames'] },
) {
  // `MessageList` is memoized so a composer keystroke does not re-render the transcript; these two
  // props would otherwise be fresh objects on every render and defeat it.
  const { queuedMessages, cancelQueuedMessage } = pane;
  const pendingPrompts = useMemo(
    () => queuedMessages.map(input => ({ ...input, onCancel: () => cancelQueuedMessage({ id: input.id }) })),
    [queuedMessages, cancelQueuedMessage],
  );
  const projectFileNameSet = useMemo(
    () => (projectFileNames === undefined ? undefined : new Set(projectFileNames)),
    [projectFileNames],
  );
  return { pendingPrompts, projectFileNameSet };
}

/** `composerSlots`'s type excludes both `leadingAccessories` and `footerAccessories` (see
 * `ChatPaneProps.composerSlots`'s doc), so the two explicit keys below are never overwriting a
 * caller-supplied value — they are the ONLY source for both. */
function buildChatPaneSlots(
  { surfaceSlots, embed, renderRuntimePicker }: {
    surfaceSlots: ReturnType<typeof useChatPaneSurface>['composerSlots'];
    embed: boolean;
    renderRuntimePicker: () => ReactNode;
  },
  { leadingAccessory }: { leadingAccessory?: ReactNode },
): ComposerSlots {
  return definedProps({ source: {
    ...surfaceSlots,
    leadingAccessories: embed ? undefined : leadingAccessory,
    footerAccessories: embed ? undefined : renderRuntimePicker(),
  } });
}

interface ChatPaneTranscriptProps {
  pane: UseChatPaneResult;
  emptyState: ReactNode;
  embed: boolean;
  suggestions: readonly string[];
  onSelectSuggestion: (suggestion: string) => void;
  pendingPrompts: ReturnType<typeof useChatPaneTranscriptProps>['pendingPrompts'];
  projectFileNameSet: Set<string> | undefined;
  toolCallDisplay: ResolvedChatPaneProps['toolCallDisplay'];
  showUsageLine: boolean;
  showThinking: boolean;
  t: (key: string) => string;
}

function ChatPaneTranscript({
  pane,
  emptyState,
  embed,
  suggestions,
  onSelectSuggestion,
  pendingPrompts,
  projectFileNameSet,
  toolCallDisplay,
  showUsageLine,
  showThinking,
  t,
}: ChatPaneTranscriptProps): ReactNode {
  if (pane.conversation.messages.length === 0 && emptyState) {
    return (
      <div className="jini-message-list jini-message-list--empty">
        {emptyState}
        {embed && <ChatPaneSuggestionsRow suggestions={suggestions} onSelect={onSelectSuggestion} t={t} />}
      </div>
    );
  }
  return (
    <MessageList
      messages={pane.conversation.messages}
      isStreaming={pane.conversation.isStreaming}
      scrollIntent={pane.conversation.scrollIntent}
      onScrolled={pane.conversation.acknowledgeScroll}
      pendingPrompts={pendingPrompts}
      toolCallDisplay={toolCallDisplay}
      showUsageLine={showUsageLine}
      showThinking={showThinking}
      {...(projectFileNameSet === undefined ? {} : { projectFileNames: projectFileNameSet })}
    />
  );
}

/** The controls-area suggestions row shows on every workspace surface, and on the embed surface
 * only when the empty transcript has no `emptyState` to host it instead. */
function showsControlsSuggestions(embed: boolean, messageCount: number, emptyState: ReactNode): boolean {
  return !embed || (messageCount === 0 && !emptyState);
}

/**
 * Renders the self-contained chat-pane composition, including runtime and
 * working-directory orchestration owned by `@jini-ai/chat-react`.
 *
 * @complexity Time/space: O(n) in rendered messages, agents, and suggestions.
 * @overallScore 100/100
 */
export function ChatPane(props: ChatPaneProps) {
  const p = applyChatPaneDefaults(props);
  const t = useT();
  const surface = useChatPaneSurface({
    variant: p.variant,
    composerSlots: p.composerSlots,
    workingDirectoryControlPlacement: p.workingDirectoryControlPlacement,
    uploadAttachments: p.uploadAttachments,
  });
  const composerPlaceholder = useChatPaneComposerPlaceholder({ placeholder: p.placeholder, placeholders: p.placeholders });
  const inventory = useChatPaneRuntimeInventory(definedProps({ source: {
    access: p.runtimeAccess,
    initialAgents: p.agents,
    pollIntervalMs: p.runtimeStatusPollMs,
  } }));
  const runtimeView = resolveRuntimeAccessView(
    p.runtimeAccess,
    p.agents,
    p.scanningAgents,
    p.daemonOnline,
    p.onRescanAgents,
    inventory,
  );
  // Computed once and threaded into both `useChatPane` (so `sendBlocker` agrees) and this
  // component's own `unavailable` below (so the status banner and composer agree) — see
  // `isChatPaneApiModeConfigured` for why API mode alone isn't enough.
  const apiModeConfigured = isChatPaneApiModeConfigured({
    executionMode: p.executionMode,
    apiModeAvailable: p.apiModeAvailable,
    byokRuntime: p.byokRuntime,
  });
  const pane = useChatPane(definedProps({ source: {
    transport: p.transport,
    agents: runtimeView.agents,
    initialMessages: p.initialMessages,
    refreshSignal: p.refreshSignal,
    conversationId: p.conversationId,
    initialSelection: p.initialSelection,
    selection: p.selection,
    onSelectionChange: p.onSelectionChange,
    runContext: p.runContext,
    initialDraft: p.initialDraft,
    composerHistoryScope: p.composerHistoryScope,
    composerHistoryStorage: p.composerHistoryStorage,
    composerHistoryCap: p.composerHistoryCap,
    validateAttachments: p.validateAttachments,
    uploadAttachments: p.uploadAttachments,
    onActivityChange: p.onActivityChange,
    onMessagesChange: p.onMessagesChange,
    redactUserText: p.redactUserText,
    onSecretRedacted: p.onSecretRedacted,
    workingDirectory: p.workingDirectory,
    initialWorkingDirectory: p.initialWorkingDirectory,
    onChangeWorkingDirectory: p.onChangeWorkingDirectory,
    workingDirectoryAccess: p.workingDirectoryAccess,
    apiModeConfigured,
    deliverTypedAnswer: p.deliverTypedAnswer,
    deliverMidRunMessage: p.deliverMidRunMessage,
  } }));
  useComposerHandlePublisher({ pane }, definedProps({ source: { composerHandle: p.composerHandle } }));
  // No `runContext` here on purpose: agent-driven sends go through `pane.sendPrompt`, which builds
  // the context from the SAME `runContext` already handed to `useChatPane` above. A second copy
  // would be a second source of truth that could silently drift from the composer's.
  useChatPaneAgentControl({ pane: pane }, resolveAgentControlOptions(p.agentControl));
  // Selection resolution only returns available agents, so absence normally means nothing usable
  // is selected — except a configured BYOK turn (`apiModeConfigured`, computed above), which calls
  // the provider directly over HTTP and never touches the CLI inventory.
  const unavailable = pane.selectedAgent === undefined && !apiModeConfigured;
  const fileDrop = useChatPaneFileDrop({
    enabled: isChatPaneFileDropEnabled({
      canUpload: surface.uploadAttachments !== undefined,
      disabled: p.disabled,
      unavailable,
      uploading: pane.isUploadingAttachments,
    }),
    onFiles: pane.addAttachments,
  });
  const slots = buildChatPaneSlots({
    surfaceSlots: surface.composerSlots,
    embed: surface.embed,
    renderRuntimePicker: () => (
      <AgentRuntimePicker
        agents={runtimeView.agents}
        value={pane.selection}
        onChange={pane.setSelection}
        {...definedProps({ source: { onRescan: runtimeView.rescanAgents } })}
        scanning={runtimeView.scanningAgents}
        daemonOnline={runtimeView.daemonOnline}
        placement={p.runtimePickerPlacement}
        executionMode={p.executionMode}
        apiModeAvailable={p.apiModeAvailable}
        {...definedProps({ source: {
          onExecutionModeChange: p.onExecutionModeChange,
          byokRuntime: p.byokRuntime,
          onByokModelChange: p.onByokModelChange,
          nativeToolPolicy: p.nativeToolPolicy,
        } })}
      />
    ),
  }, { leadingAccessory: p.leadingAccessory });

  const { rootRef, controlsRef } = useChatPaneControlsHeight();
  const selectSuggestion = useChatPaneSuggestion({ rootRef, setDraft: pane.composer.setDraft });
  const openLinkInNewTab = useChatPaneNewTabLinks();
  const { pendingPrompts, projectFileNameSet } = useChatPaneTranscriptProps(
    { pane },
    definedProps({ source: { projectFileNames: p.projectFileNames } }),
  );

  return (
    <section
      className={chatPaneClassName(p.variant, p.className)}
      style={p.style}
      data-activity={pane.activity}
      ref={rootRef}
      onClickCapture={openLinkInNewTab}
    >
      <style data-jini-chat-pane-styles="true">{CHAT_PANE_STYLES}</style>
      {/* The former forwarding helper only moved this nested `??` out of ChatPane's score. */}
      {p.header ?? defaultHeader(p.title, pane.reset, t)}
      {p.agentPluginsMode !== 'off' && <AgentPluginUsage conversationId={pane.conversation.conversationId} messages={pane.conversation.messages} />}
      <div className="jini-chat-pane__body">
        <ChatPaneTranscript
          pane={pane}
          emptyState={p.emptyState}
          embed={surface.embed}
          suggestions={p.suggestions}
          onSelectSuggestion={selectSuggestion}
          pendingPrompts={pendingPrompts}
          projectFileNameSet={projectFileNameSet}
          toolCallDisplay={p.toolCallDisplay}
          showUsageLine={p.showUsageLine}
          showThinking={p.showThinking}
          t={t}
        />
        <div className="jini-chat-pane__controls" ref={controlsRef}>
          {showsControlsSuggestions(surface.embed, pane.conversation.messages.length, p.emptyState) && (
            <ChatPaneSuggestionsRow suggestions={p.suggestions} onSelect={selectSuggestion} t={t} />
          )}
          {pane.secretRedacted ? <div className="jini-chat-pane__notice" role="status">{t(SECRET_REDACTED_NOTICE)}</div> : null}
          <ChatPaneStatusMessages
            unavailable={unavailable}
            scanningAgents={runtimeView.scanningAgents}
            connectingAgents={runtimeView.connectingAgents}
            executionMode={p.executionMode}
            apiModeAvailable={p.apiModeAvailable}
            onExecutionModeChange={p.onExecutionModeChange}
            sendError={pane.conversation.sendError}
            onRetrySend={() => void pane.retrySend()}
            attachmentError={pane.attachmentError}
            dropReadError={fileDrop.dropReadError}
            workingDirectoryError={pane.workingDirectoryError}
            workingDirectoryPending={pane.workingDirectoryPending}
            workingDirectoryInvalid={pane.workingDirectoryInvalid}
            runtimeInventoryError={inventory.runtimeInventoryError}
            typedAnswerNotice={pane.typedAnswerNotice}
            t={t}
          />
          <ChatPaneComposerArea
            fileDrop={fileDrop}
            uploadAttachments={surface.uploadAttachments}
            pane={pane}
            disabled={p.disabled}
            unavailable={unavailable}
            placeholder={composerPlaceholder}
            slots={slots}
            attachmentAccept={p.attachmentAccept}
            workingDirectoryAccess={p.workingDirectoryAccess}
            workingDirectoryControlPlacement={surface.workingDirectoryControlPlacement}
            t={t}
          />
        </div>
      </div>
      {p.footer}
    </section>
  );
}
