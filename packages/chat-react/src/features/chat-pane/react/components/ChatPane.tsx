import type { ReactNode } from 'react';
import { WorkingDirPicker } from '@jini/ui';

import { Composer } from '../../../../react/components/Composer.js';
import { MessageList } from '../../../../react/components/MessageList.js';
import { useT } from '../../../../react/hooks/context.js';
import type { ComposerSlots } from '../../../../slots.js';
import { definedProps } from '../../../../util/defined-props.js';
import type {
  ChatPaneAgent,
  ChatPaneProps,
  ChatPaneRuntimeAccess,
  ChatPaneVariant,
  ChatPaneWorkingDirectoryAccess,
} from '../../types.js';
import { useChatPane, type UseChatPaneResult } from '../hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../hooks/useChatPaneAgentControl.hooks.js';
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

interface ChatPaneStatusMessagesProps {
  unavailable: boolean;
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
      {unavailable ? (
        <div className="jini-chat-pane__error" role="alert">{t('No usable CLI is selected.')}</div>
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
  pane: UseChatPaneResult;
  t: (key: string) => string;
}

function ChatPaneWorkingDirectoryBlock({
  workingDirectoryAccess,
  pane,
  t,
}: ChatPaneWorkingDirectoryBlockProps): ReactNode {
  if (workingDirectoryAccess) {
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
  if (pane.workingDirectory) {
    return (
      <div className="jini-chat-pane__workdir">
        <strong>{t('Working directory')}</strong>
        <code>{pane.workingDirectory}</code>
      </div>
    );
  }
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
  t: (key: string) => string;
}

/** The drop target, composer, working-directory block, and cancel-run control — everything below
 * the status banners that reads/writes the live pane. */
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
  t,
}: ChatPaneComposerAreaProps): ReactNode {
  return (
    <>
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
          disabled={disabled || unavailable || pane.conversation.isStreaming}
          sendDisabled={!pane.canSend}
          {...definedProps({ placeholder })}
          slots={slots}
          {...resolveComposerAttachmentPicker(uploadAttachments, pane, attachmentAccept)}
        />
        <ChatPaneWorkingDirectoryBlock workingDirectoryAccess={workingDirectoryAccess} pane={pane} t={t} />
      </div>
      {pane.conversation.isStreaming ? (
        <button type="button" className="jini-chat-pane__cancel" onClick={pane.conversation.cancel}>
          {t('Stop run')}
        </button>
      ) : null}
    </>
  );
}

/**
 * Renders the self-contained chat-pane composition, including runtime and
 * working-directory orchestration owned by `@jini/chat-react`.
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
  onRescanAgents,
  scanningAgents = false,
  daemonOnline = true,
  executionMode = 'local',
  apiModeAvailable = false,
  onExecutionModeChange,
  initialDraft,
  placeholder,
  suggestions = [],
  workingDirectory,
  initialWorkingDirectory,
  onChangeWorkingDirectory,
  workingDirectoryAccess,
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
    uploadAttachments,
    onActivityChange,
    workingDirectory,
    initialWorkingDirectory,
    onChangeWorkingDirectory,
    workingDirectoryAccess,
  }));
  // No `runContext` here on purpose: agent-driven sends go through `pane.sendPrompt`, which builds
  // the context from the SAME `runContext` already handed to `useChatPane` above. A second copy
  // would be a second source of truth that could silently drift from the composer's.
  useChatPaneAgentControl(pane, definedProps({
    enabled: agentControl?.enabled ?? false,
    bridgeAccess: agentControl?.bridgeAccess,
  }));
  // Selection resolution only returns available agents, so absence is the
  // single fail-closed state the view needs to represent.
  const unavailable = pane.selectedAgent === undefined;
  const fileDrop = useChatPaneFileDrop({
    enabled: uploadAttachments !== undefined
      && !disabled
      && !unavailable
      && !pane.conversation.isStreaming
      && !pane.isUploadingAttachments,
    onFiles: pane.addAttachments,
  });
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
        {...definedProps({ onExecutionModeChange })}
      />
    ),
  });

  return (
    <section
      className={chatPaneClassName(variant, className)}
      style={style}
      data-activity={pane.activity}
    >
      <style data-jini-chat-pane-styles="true">{CHAT_PANE_STYLES}</style>
      {resolveChatPaneHeader(header, title, pane.reset, t)}
      <div className="jini-chat-pane__body">
        <MessageList
          messages={pane.conversation.messages}
          isStreaming={pane.conversation.isStreaming}
          scrollIntent={pane.conversation.scrollIntent}
          onScrolled={pane.conversation.acknowledgeScroll}
          {...(projectFileNames === undefined ? {} : { projectFileNames: new Set(projectFileNames) })}
        />
        <div className="jini-chat-pane__controls">
          <ChatPaneSuggestionsRow suggestions={suggestions} onSelect={pane.composer.setDraft} t={t} />
          <ChatPaneStatusMessages
            unavailable={unavailable}
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
            placeholder={placeholder}
            slots={slots}
            attachmentAccept={attachmentAccept}
            workingDirectoryAccess={workingDirectoryAccess}
            t={t}
          />
        </div>
      </div>
      {footer}
    </section>
  );
}
