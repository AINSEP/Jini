import type { ReactNode } from 'react';
import { WorkingDirPicker } from '@jini/ui';

import { Composer } from '../../../../react/components/Composer.js';
import { MessageList } from '../../../../react/components/MessageList.js';
import { useT } from '../../../../react/hooks/context.js';
import type { ComposerSlots } from '../../../../slots.js';
import type { ChatPaneProps } from '../../types.js';
import { useChatPane } from '../hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../hooks/useChatPaneAgentControl.hooks.js';
import { useChatPaneFileDrop } from '../hooks/useChatPaneFileDrop.hooks.js';
import { useChatPaneRuntimeInventory } from '../hooks/useChatPaneRuntimeInventory.hooks.js';
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
  const inventory = useChatPaneRuntimeInventory({
    ...(runtimeAccess === undefined ? {} : { access: runtimeAccess }),
    initialAgents: injectedAgents,
    pollIntervalMs: runtimeStatusPollMs,
  });
  const agents = runtimeAccess === undefined ? injectedAgents : inventory.agents;
  const resolvedScanningAgents = runtimeAccess === undefined
    ? scanningAgents
    : inventory.scanningAgents;
  const resolvedDaemonOnline = runtimeAccess === undefined
    ? daemonOnline
    : inventory.daemonOnline;
  const rescanAgents = runtimeAccess === undefined
    ? onRescanAgents
    : () => void inventory.rescanAgents();
  const pane = useChatPane({
    transport,
    agents,
    ...(initialMessages === undefined ? {} : { initialMessages }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(initialSelection === undefined ? {} : { initialSelection }),
    ...(controlledSelection === undefined ? {} : { selection: controlledSelection }),
    ...(onSelectionChange === undefined ? {} : { onSelectionChange }),
    ...(runContext === undefined ? {} : { runContext }),
    ...(initialDraft === undefined ? {} : { initialDraft }),
    ...(uploadAttachments === undefined ? {} : { uploadAttachments }),
    ...(onActivityChange === undefined ? {} : { onActivityChange }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(initialWorkingDirectory === undefined ? {} : { initialWorkingDirectory }),
    ...(onChangeWorkingDirectory === undefined ? {} : { onChangeWorkingDirectory }),
    ...(workingDirectoryAccess === undefined ? {} : { workingDirectoryAccess }),
  });
  // No `runContext` here on purpose: agent-driven sends go through `pane.sendPrompt`, which builds
  // the context from the SAME `runContext` already handed to `useChatPane` above. A second copy
  // would be a second source of truth that could silently drift from the composer's.
  useChatPaneAgentControl(pane, {
    enabled: agentControl?.enabled ?? false,
    ...(agentControl?.bridgeAccess === undefined ? {} : { bridgeAccess: agentControl.bridgeAccess }),
  });
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
  const slots: ComposerSlots = {
    ...composerSlots,
    ...(leadingAccessory === undefined ? {} : { leadingAccessories: leadingAccessory }),
    footerAccessories: (
      <AgentRuntimePicker
        agents={agents}
        value={pane.selection}
        onChange={pane.setSelection}
        {...(rescanAgents === undefined ? {} : { onRescan: rescanAgents })}
        scanning={resolvedScanningAgents}
        daemonOnline={resolvedDaemonOnline}
        placement={runtimePickerPlacement}
        executionMode={executionMode}
        apiModeAvailable={apiModeAvailable}
        {...(onExecutionModeChange === undefined ? {} : { onExecutionModeChange })}
      />
    ),
  };

  return (
    <section
      className={`jini-chat-pane jini-chat-pane--${variant}${className ? ` ${className}` : ''}`}
      style={style}
      data-activity={pane.activity}
    >
      <style data-jini-chat-pane-styles="true">{CHAT_PANE_STYLES}</style>
      {header ?? defaultHeader(title, pane.reset, t)}
      <div className="jini-chat-pane__body">
        <MessageList
          messages={pane.conversation.messages}
          isStreaming={pane.conversation.isStreaming}
          scrollIntent={pane.conversation.scrollIntent}
          onScrolled={pane.conversation.acknowledgeScroll}
          {...(projectFileNames === undefined ? {} : { projectFileNames: new Set(projectFileNames) })}
        />
        <div className="jini-chat-pane__controls">
          {suggestions.length > 0 ? (
            <div className="jini-chat-pane__suggestions" aria-label={t('Example prompts')}>
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  className="jini-chat-pane__suggestion"
                  key={suggestion}
                  onClick={() => pane.composer.setDraft(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          {unavailable ? (
            <div className="jini-chat-pane__error" role="alert">{t('No usable CLI is selected.')}</div>
          ) : null}
          {pane.conversation.error ? (
            <div className="jini-chat-pane__error" role="alert">{pane.conversation.error.message}</div>
          ) : null}
          {pane.attachmentError ? (
            <div className="jini-chat-pane__error" role="alert">{pane.attachmentError.message}</div>
          ) : null}
          {fileDrop.dropReadError ? (
            <div className="jini-chat-pane__error" role="alert">{fileDrop.dropReadError}</div>
          ) : null}
          {pane.workingDirectoryError ? (
            <div className="jini-chat-pane__error" role="alert">{pane.workingDirectoryError.message}</div>
          ) : null}
          {pane.workingDirectoryPending ? (
            <div className="jini-chat-pane__status" role="status">
              {t('Checking working directory…')}
            </div>
          ) : pane.workingDirectoryInvalid ? (
            <div className="jini-chat-pane__error" role="alert">
              {t('Working directory is unavailable.')}
            </div>
          ) : null}
          {inventory.runtimeInventoryError ? (
            <div className="jini-chat-pane__error" role="alert">
              {inventory.runtimeInventoryError.message}
            </div>
          ) : null}
          <div
            className={`jini-chat-pane__drop-target${fileDrop.draggingFiles ? ' is-dragging-files' : ''}`}
            data-testid="chat-pane-file-drop-target"
            data-dragging-files={fileDrop.draggingFiles ? 'true' : 'false'}
            {...(uploadAttachments === undefined ? {} : fileDrop.targetProps)}
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
              {...(placeholder === undefined ? {} : { placeholder })}
              slots={slots}
              {...(uploadAttachments === undefined
                ? {}
                : {
                    attachmentPicker: {
                      onFiles: pane.addAttachments,
                      uploading: pane.isUploadingAttachments,
                      ...(attachmentAccept === undefined ? {} : { accept: attachmentAccept }),
                    },
                  })}
            />
            {workingDirectoryAccess ? (
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
            ) : pane.workingDirectory ? (
              <div className="jini-chat-pane__workdir">
                <strong>{t('Working directory')}</strong>
                <code>{pane.workingDirectory}</code>
              </div>
            ) : null}
          </div>
          {pane.conversation.isStreaming ? (
            <button type="button" className="jini-chat-pane__cancel" onClick={pane.conversation.cancel}>
              {t('Stop run')}
            </button>
          ) : null}
        </div>
      </div>
      {footer}
    </section>
  );
}
