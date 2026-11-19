import { useMemo, type ReactNode, type RefObject } from 'react';
import { AgentPluginUsage } from './AgentPluginUsage.js';
import { SECRET_REDACTED_NOTICE } from '../../../../core/user-text-redaction.js';
import { MessageList } from '../../../components/MessageList.js';
import type { ComposerSlots } from '../../../slots.js';
import { definedProps } from '../../../util/defined-props.js';
import type { ChatPaneProps, ChatPaneVariant } from '../types.js';
import type { ResolvedChatPaneProps, ChatPaneRuntimeView } from './ChatPane.js';
import type { UseChatPaneResult } from '../hooks/useChatPane.hooks.js';
import type { UseChatPaneFileDropResult } from '../hooks/useChatPaneFileDrop.hooks.js';
import type { UseChatPaneRuntimeInventoryResult } from '../hooks/useChatPaneRuntimeInventory.hooks.js';
import type { useChatPaneSurface } from '../hooks/useChatPaneSurface.hooks.js';
import { useChatPaneControlsHeight } from '../hooks/useChatPaneControlsHeight.hooks.js';
import { useChatPaneSuggestion } from '../hooks/useChatPaneSuggestion.hooks.js';
import { useChatPaneNewTabLinks } from '../hooks/useChatPaneNewTabLinks.hooks.js';
import { CHAT_PANE_STYLES } from '../styles.js';
import { ChatPaneStatusMessages } from './ChatPaneStatus.js';
import { ChatPaneComposerArea } from './ChatPaneComposerArea.js';

interface ChatPaneLayoutProps {
  p: ResolvedChatPaneProps; pane: UseChatPaneResult; surface: ReturnType<typeof useChatPaneSurface>;
  runtimeView: ChatPaneRuntimeView; base: string | undefined; unavailable: boolean;
  fileDrop: UseChatPaneFileDropResult; inventory: UseChatPaneRuntimeInventoryResult;
  t: (key: string) => string; slots: ComposerSlots; composerPlaceholder: string | undefined;
}

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

export function useChatPaneTranscriptProps(
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

interface ChatPaneTranscriptProps {
  pane: UseChatPaneResult;
  sendingLabel: ChatPaneProps['sendingLabel'];
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
  sendingLabel,
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
      {...definedProps({ source: { sendingLabel } })}
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


export function ChatPaneLayout({ p, pane, surface, runtimeView, base, unavailable, fileDrop, inventory, t, slots, composerPlaceholder,
  useChatPaneControlsHeightHook = useChatPaneControlsHeight, useChatPaneSuggestionHook = useChatPaneSuggestion,
  useChatPaneNewTabLinksHook = useChatPaneNewTabLinks, useChatPaneTranscriptPropsHook = useChatPaneTranscriptProps,
}: ChatPaneLayoutProps & Pick<ChatPaneProps, 'useChatPaneControlsHeightHook' | 'useChatPaneSuggestionHook' | 'useChatPaneNewTabLinksHook' | 'useChatPaneTranscriptPropsHook'>) {
  const { rootRef, controlsRef } = useChatPaneControlsHeightHook();
  const selectSuggestion = useChatPaneSuggestionHook({ rootRef, setDraft: pane.composer.setDraft });
  const openLinkInNewTab = useChatPaneNewTabLinksHook();
  const { pendingPrompts, projectFileNameSet } = useChatPaneTranscriptPropsHook(
    { pane }, definedProps({ source: { projectFileNames: p.projectFileNames } }),
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
        <ChatPaneTranscript pane={pane} sendingLabel={p.sendingLabel} emptyState={p.emptyState} embed={surface.embed}
          suggestions={p.suggestions} onSelectSuggestion={selectSuggestion} pendingPrompts={pendingPrompts}
          projectFileNameSet={projectFileNameSet} toolCallDisplay={p.toolCallDisplay}
          showUsageLine={p.showUsageLine} showThinking={p.showThinking} t={t} />
        <ChatPaneControls p={p} pane={pane} surface={surface} runtimeView={runtimeView} base={base}
          unavailable={unavailable} fileDrop={fileDrop} inventory={inventory} t={t} slots={slots}
          composerPlaceholder={composerPlaceholder} selectSuggestion={selectSuggestion} controlsRef={controlsRef} />
      </div>
      {p.footer}
    </section>
  );
}

function ChatPaneControls({ p, pane, surface, runtimeView, base, unavailable, fileDrop, inventory, t, slots, composerPlaceholder,
  selectSuggestion, controlsRef,
}: ChatPaneLayoutProps & { selectSuggestion: (suggestion: string) => void; controlsRef: RefObject<HTMLDivElement | null> }) {
  return (
        <div className="jini-chat-pane__controls" ref={controlsRef}>
          {showsControlsSuggestions(surface.embed, pane.conversation.messages.length, p.emptyState) && (
            <ChatPaneSuggestionsRow suggestions={p.suggestions} onSelect={selectSuggestion} t={t} />
          )}
          {pane.secretRedacted ? (
            <div className="jini-chat-pane__status jini-chat-pane__status--dismissible" role="status">
              <span>{t(SECRET_REDACTED_NOTICE)}</span>
              <button type="button" className="jini-chat-pane__error-action" onClick={pane.dismissSecretRedacted}>{t('Dismiss')}</button>
            </div>
          ) : null}
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
          <ChatPaneComposerArea report={p.report} agentHandle={base ? `${base}-composer` : false} fileDrop={fileDrop}
            uploadAttachments={surface.uploadAttachments} pane={pane} disabled={p.disabled} unavailable={unavailable}
            placeholder={composerPlaceholder} slots={slots} attachmentAccept={p.attachmentAccept}
            workingDirectoryAccess={p.workingDirectoryAccess} workingDirectoryControlPlacement={surface.workingDirectoryControlPlacement} t={t} />
        </div>
  );
}
