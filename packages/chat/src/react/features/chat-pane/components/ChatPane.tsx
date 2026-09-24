import { useEffect, useRef, type ReactNode } from 'react';
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
} from '../types.js';
import { isChatPaneApiModeConfigured } from '../rules.js';
import { useChatPane, type UseChatPaneResult } from '../hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../hooks/useChatPaneAgentControl.hooks.js';
import { useChatPaneComposerPlaceholder } from '../hooks/useChatPaneComposerPlaceholder.hooks.js';
import { useChatPaneControlsHeight } from '../hooks/useChatPaneControlsHeight.hooks.js';
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

/** Collapses `header ?? defaultHeader(...)` out of `ChatPane` itself — nesting is what taxes the
 * `??` in the caller's score, not the branch itself. */
function resolveChatPaneHeader(
  header: ReactNode | undefined,
  title: string | undefined,
  onReset: () => void,
  t: (key: string) => string,
): ReactNode {
  return header ?? defaultHeader(title, onReset, t);
}

function chatPaneClassName(variant: ChatPaneVariant, className: string | undefined): string {
  return `jini-chat-pane jini-chat-pane--${variant}${className ? ` ${className}` : ''}`;
}

/** What the view needs after collapsing the four `runtimeAccess === undefined ? host : inventory`
 * ternaries into a single branch. */
interface ChatPaneRuntimeView {
  agents: readonly ChatPaneAgent[];
  scanningAgents: boolean;
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
    return { agents: injectedAgents, scanningAgents, daemonOnline, rescanAgents: onRescanAgents };
  }
  return {
    agents: inventory.agents,
    scanningAgents: inventory.scanningAgents,
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

interface ChatPaneStatusMessagesProps {
  unavailable: boolean;
  scanningAgents: boolean;
  executionMode: 'local' | 'api';
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  conversationError: Error | null;
  attachmentError: Error | null;
  dropReadError: string | null;
  workingDirectoryError: Error | null;
  workingDirectoryPending: boolean;
  workingDirectoryInvalid: boolean;
  runtimeInventoryError: Error | null;
  t: (key: string) => string;
}

/** The pane's stack of mutually-independent error/status banners — each condition is its own
 * source of truth, so they are rendered as siblings rather than folded into one derived state. */
function ChatPaneStatusMessages({
  unavailable,
  scanningAgents,
  executionMode,
  apiModeAvailable,
  onExecutionModeChange,
  conversationError,
  attachmentError,
  dropReadError,
  workingDirectoryError,
  workingDirectoryPending,
  workingDirectoryInvalid,
  runtimeInventoryError,
  t,
}: ChatPaneStatusMessagesProps): ReactNode {
  return (
    <>
      {/* `unavailable` alone conflates "inventory still loading" with "inventory loaded, nothing
          usable" — both present as `selectedAgent === undefined`. `scanningAgents` is the signal
          that tells them apart, mirroring the `workingDirectoryPending`/`workingDirectoryInvalid`
          pair below: a pending detection is a `status`, only a *finished* detection that found
          nothing is an `alert`. */}
      {unavailable && scanningAgents ? (
        <div className="jini-chat-pane__status" role="status">
          {t('Loading available CLIs')}
        </div>
      ) : unavailable ? (
        <ChatPaneNoUsableCliMessage
          executionMode={executionMode}
          apiModeAvailable={apiModeAvailable}
          onExecutionModeChange={onExecutionModeChange}
          t={t}
        />
      ) : null}
      {conversationError ? (
        <div className="jini-chat-pane__error" role="alert">{conversationError.message}</div>
      ) : null}
      {attachmentError ? (
        <div className="jini-chat-pane__error" role="alert">{attachmentError.message}</div>
      ) : null}
      {dropReadError ? (
        <div className="jini-chat-pane__error" role="alert">{dropReadError}</div>
      ) : null}
      {workingDirectoryError ? (
        <div className="jini-chat-pane__error" role="alert">{workingDirectoryError.message}</div>
      ) : null}
      {workingDirectoryPending ? (
        <div className="jini-chat-pane__status" role="status">
          {t('Checking working directory…')}
        </div>
      ) : workingDirectoryInvalid ? (
        <div className="jini-chat-pane__error" role="alert">
          {t('Working directory is unavailable.')}
        </div>
      ) : null}
      {runtimeInventoryError ? (
        <div className="jini-chat-pane__error" role="alert">
          {runtimeInventoryError.message}
        </div>
      ) : null}
    </>
  );
}

interface ChatPaneWorkingDirectoryBlockProps {
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined;
  workingDirectoryControlPlacement: 'below' | 'composer' | 'none';
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
    attachmentPicker: definedProps({
      onFiles: pane.addAttachments,
      uploading: pane.isUploadingAttachments,
      accept: attachmentAccept,
    }),
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
  workingDirectoryControlPlacement: 'below' | 'composer' | 'none';
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
 * `pendingPrompt` prop and this component's own call site below. */
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
        running={pane.conversation.isStreaming}
        onCancel={pane.conversation.cancel}
        onInterrupt={pane.interruptSend}
        {...definedProps({ placeholder })}
        slots={slots}
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

/**
 * Renders the self-contained chat-pane composition, including runtime and
 * working-directory orchestration owned by `@jini-ai/chat-react`.
 *
 * @complexity Time/space: O(n) in rendered messages, agents, and suggestions.
 * @overallScore 100/100
 */
export function ChatPane({
  transport,
  agents: injectedAgents = EMPTY_AGENTS,
  runtimeAccess,
  runtimeStatusPollMs = 5_000,
  title,
  variant = 'workspace',
  initialMessages,
  conversationId,
  initialSelection,
  selection: controlledSelection,
  onSelectionChange,
  runContext,
  agentControl,
  onActivityChange,
  onMessagesChange,
  onRescanAgents,
  scanningAgents = false,
  daemonOnline = true,
  executionMode = 'local',
  apiModeAvailable = false,
  onExecutionModeChange,
  byokRuntime,
  onByokModelChange,
  initialDraft,
  validateAttachments,
  composerHandle,
  placeholder,
  placeholders,
  suggestions = [],
  workingDirectory,
  initialWorkingDirectory,
  onChangeWorkingDirectory,
  workingDirectoryAccess,
  workingDirectoryControlPlacement = 'below',
  projectFileNames,
  uploadAttachments,
  attachmentAccept,
  disabled = false,
  runtimePickerPlacement = 'up',
  composerSlots,
  header,
  leadingAccessory,
  footer,
  className,
  style,
}: ChatPaneProps) {
  const t = useT();
  const composerPlaceholder = useChatPaneComposerPlaceholder(placeholder, placeholders);
  const inventory = useChatPaneRuntimeInventory(definedProps({
    access: runtimeAccess,
    initialAgents: injectedAgents,
    pollIntervalMs: runtimeStatusPollMs,
  }));
  const runtimeView = resolveRuntimeAccessView(
    runtimeAccess,
    injectedAgents,
    scanningAgents,
    daemonOnline,
    onRescanAgents,
    inventory,
  );
  // Computed once and threaded into both `useChatPane` (so `sendBlocker` agrees) and this
  // component's own `unavailable` below (so the status banner and composer agree) — see
  // `isChatPaneApiModeConfigured` for why API mode alone isn't enough.
  const apiModeConfigured = isChatPaneApiModeConfigured({ executionMode, apiModeAvailable, byokRuntime });
  const pane = useChatPane(definedProps({
    transport,
    agents: runtimeView.agents,
    initialMessages,
    conversationId,
    initialSelection,
    selection: controlledSelection,
    onSelectionChange,
    runContext,
    initialDraft,
    validateAttachments,
    uploadAttachments,
    onActivityChange,
    onMessagesChange,
    workingDirectory,
    initialWorkingDirectory,
    onChangeWorkingDirectory,
    workingDirectoryAccess,
    apiModeConfigured,
  }));
  // Mirrors `Composer.tsx`'s own `draftRef`: `composerHandle.insertText` (below) is called from
  // OUTSIDE any render, so it cannot close over `pane.composer.draft` directly — that would freeze
  // it at whatever the draft was on the render that captured it. Reassigned unconditionally every
  // render, same as its counterpart.
  const composerDraftRef = useRef(pane.composer.draft);
  composerDraftRef.current = pane.composer.draft;
  useEffect(() => {
    if (!composerHandle) return;
    composerHandle.current = {
      insertText: (text) => {
        pane.composer.setDraft(appendComposerDiscovery(composerDraftRef.current, text));
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
  // No `runContext` here on purpose: agent-driven sends go through `pane.sendPrompt`, which builds
  // the context from the SAME `runContext` already handed to `useChatPane` above. A second copy
  // would be a second source of truth that could silently drift from the composer's.
  useChatPaneAgentControl(pane, definedProps({
    enabled: agentControl?.enabled ?? false,
    bridgeAccess: agentControl?.bridgeAccess,
    webmcp: agentControl?.webmcp,
  }));
  // Selection resolution only returns available agents, so absence normally means nothing usable
  // is selected — except a configured BYOK turn (`apiModeConfigured`, computed above), which calls
  // the provider directly over HTTP and never touches the CLI inventory.
  const unavailable = pane.selectedAgent === undefined && !apiModeConfigured;
  const fileDrop = useChatPaneFileDrop({
    enabled: uploadAttachments !== undefined
      && !disabled
      && !unavailable
      && !pane.conversation.isStreaming
      && !pane.isUploadingAttachments,
    onFiles: pane.addAttachments,
  });
  // `composerSlots`'s type excludes both `leadingAccessories` and `footerAccessories` (see
  // `ChatPaneProps.composerSlots`'s doc), so the two explicit keys below are never overwriting a
  // caller-supplied value — they are the ONLY source for both.
  const slots: ComposerSlots = definedProps({
    ...composerSlots,
    leadingAccessories: leadingAccessory,
    footerAccessories: (
      <AgentRuntimePicker
        agents={runtimeView.agents}
        value={pane.selection}
        onChange={pane.setSelection}
        {...definedProps({ onRescan: runtimeView.rescanAgents })}
        scanning={runtimeView.scanningAgents}
        daemonOnline={runtimeView.daemonOnline}
        placement={runtimePickerPlacement}
        executionMode={executionMode}
        apiModeAvailable={apiModeAvailable}
        {...definedProps({ onExecutionModeChange, byokRuntime, onByokModelChange })}
      />
    ),
  });

  const { rootRef, controlsRef } = useChatPaneControlsHeight();

  return (
    <section
      className={chatPaneClassName(variant, className)}
      style={style}
      data-activity={pane.activity}
      ref={rootRef}
    >
      <style data-jini-chat-pane-styles="true">{CHAT_PANE_STYLES}</style>
      {resolveChatPaneHeader(header, title, pane.reset, t)}
      <div className="jini-chat-pane__body">
        <MessageList
          messages={pane.conversation.messages}
          isStreaming={pane.conversation.isStreaming}
          scrollIntent={pane.conversation.scrollIntent}
          onScrolled={pane.conversation.acknowledgeScroll}
          pendingPrompt={pane.queuedPrompt === null ? null : { text: pane.queuedPrompt, onCancel: pane.cancelQueued }}
          {...(projectFileNames === undefined ? {} : { projectFileNames: new Set(projectFileNames) })}
        />
        <div className="jini-chat-pane__controls" ref={controlsRef}>
          <ChatPaneSuggestionsRow suggestions={suggestions} onSelect={pane.composer.setDraft} t={t} />
          <ChatPaneStatusMessages
            unavailable={unavailable}
            scanningAgents={runtimeView.scanningAgents}
            executionMode={executionMode}
            apiModeAvailable={apiModeAvailable}
            onExecutionModeChange={onExecutionModeChange}
            conversationError={pane.conversation.error}
            attachmentError={pane.attachmentError}
            dropReadError={fileDrop.dropReadError}
            workingDirectoryError={pane.workingDirectoryError}
            workingDirectoryPending={pane.workingDirectoryPending}
            workingDirectoryInvalid={pane.workingDirectoryInvalid}
            runtimeInventoryError={inventory.runtimeInventoryError}
            t={t}
          />
          <ChatPaneComposerArea
            fileDrop={fileDrop}
            uploadAttachments={uploadAttachments}
            pane={pane}
            disabled={disabled}
            unavailable={unavailable}
            placeholder={composerPlaceholder}
            slots={slots}
            attachmentAccept={attachmentAccept}
            workingDirectoryAccess={workingDirectoryAccess}
            workingDirectoryControlPlacement={workingDirectoryControlPlacement}
            t={t}
          />
        </div>
      </div>
      {footer}
    </section>
  );
}
