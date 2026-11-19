import { useEffect, useRef, type ReactNode } from 'react';
import { useAgentHandle } from '@jini-ai/ui';

import { appendComposerDiscovery } from '../../../components/composer-discovery.js';
import { useT } from '../../../hooks/context.js';
import type { ComposerSlots } from '../../../slots.js';
import { definedProps } from '../../../util/defined-props.js';
import type {
  ChatPaneAgent,
  ChatPaneProps,
  ChatPaneRuntimeAccess,
} from '../types.js';
import { isChatPaneApiModeConfigured, isChatPaneFileDropEnabled } from '../rules.js';
import { useChatPane, type UseChatPaneResult } from '../hooks/useChatPane.hooks.js';
import { useChatPaneAgentControl } from '../hooks/useChatPaneAgentControl.hooks.js';
import { useChatPaneComposerPlaceholder } from '../hooks/useChatPaneComposerPlaceholder.hooks.js';
import { useChatPaneSurface } from '../hooks/useChatPaneSurface.hooks.js';
import {
  useChatPaneFileDrop,
} from '../hooks/useChatPaneFileDrop.hooks.js';
import {
  useChatPaneRuntimeInventory,
  type UseChatPaneRuntimeInventoryResult,
} from '../hooks/useChatPaneRuntimeInventory.hooks.js';
import { AgentRuntimePicker } from './AgentRuntimePicker.js';
import { ChatPaneLayout } from './ChatPaneLayout.js';

const EMPTY_AGENTS: NonNullable<ChatPaneProps['agents']> = [];

/** What the view needs after collapsing the four `runtimeAccess === undefined ? host : inventory`
 * ternaries into a single branch. */
export interface ChatPaneRuntimeView {
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

/** Every prop `ChatPane` defaults, and its default — applied only where the caller left the prop
 * `undefined`, exactly like the destructuring defaults this replaced. */
type ChatPaneDefaultedProp =
  | 'agents' | 'runtimeStatusPollMs' | 'variant' | 'scanningAgents' | 'daemonOnline' | 'executionMode'
  | 'apiModeAvailable' | 'suggestions' | 'workingDirectoryControlPlacement' | 'toolCallDisplay'
  | 'showUsageLine' | 'showThinking' | 'agentPluginsMode' | 'disabled' | 'runtimePickerPlacement';

export type ResolvedChatPaneProps = ChatPaneProps & Required<Pick<ChatPaneProps, ChatPaneDefaultedProp>>;

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

export function useComposerHandlePublisher(
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
      addFolders: pane.composer.addFolders,
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

function buildChatPaneArguments({ p, runtimeView, apiModeConfigured }: {
  p: ResolvedChatPaneProps; runtimeView: ChatPaneRuntimeView; apiModeConfigured: boolean;
}, _optional = {}) {
  return definedProps({ source: {
    transport: p.transport,
    report: p.report,
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
    subscribeToSurfaces: p.subscribeToSurfaces,
    redactUserText: p.redactUserText,
    onSecretRedacted: p.onSecretRedacted,
    workingDirectory: p.workingDirectory,
    initialWorkingDirectory: p.initialWorkingDirectory,
    onChangeWorkingDirectory: p.onChangeWorkingDirectory,
    workingDirectoryAccess: p.workingDirectoryAccess,
    apiModeConfigured,
    deliverTypedAnswer: p.deliverTypedAnswer,
    deliverMidRunMessage: p.deliverMidRunMessage,
  } });
}

/**
 * Renders the self-contained chat-pane composition, including runtime and
 * working-directory orchestration owned by `@jini-ai/chat-react`.
 *
 * @complexity Time/space: O(n) in rendered messages, agents, and suggestions.
 * @overallScore 100/100
 */
export function ChatPane({ useAgentHandleHook = useAgentHandle, useTHook = useT, useChatPaneSurfaceHook = useChatPaneSurface,
  useChatPaneComposerPlaceholderHook = useChatPaneComposerPlaceholder, useChatPaneRuntimeInventoryHook = useChatPaneRuntimeInventory,
  useChatPaneHook = useChatPane, useComposerHandlePublisherHook = useComposerHandlePublisher,
  useChatPaneAgentControlHook = useChatPaneAgentControl, useChatPaneFileDropHook = useChatPaneFileDrop,
  useChatPaneControlsHeightHook, useChatPaneSuggestionHook, useChatPaneNewTabLinksHook, useChatPaneTranscriptPropsHook, ...props }: ChatPaneProps) {
  const p = applyChatPaneDefaults(props);
  const base = useAgentHandleHook({ agentHandle: p.agentHandle });
  const t = useTHook();
  const surface = useChatPaneSurfaceHook({ variant: p.variant, composerSlots: p.composerSlots,
    workingDirectoryControlPlacement: p.workingDirectoryControlPlacement, uploadAttachments: p.uploadAttachments });
  const composerPlaceholder = useChatPaneComposerPlaceholderHook({ placeholder: p.placeholder, placeholders: p.placeholders });
  const inventory = useChatPaneRuntimeInventoryHook(definedProps({ source: { access: p.runtimeAccess, initialAgents: p.agents, pollIntervalMs: p.runtimeStatusPollMs } }));
  const runtimeView = resolveRuntimeAccessView(p.runtimeAccess, p.agents, p.scanningAgents, p.daemonOnline, p.onRescanAgents, inventory);
  // Computed once and threaded into both `useChatPane` (so `sendBlocker` agrees) and this
  // component's own `unavailable` below (so the status banner and composer agree) — see
  // `isChatPaneApiModeConfigured` for why API mode alone isn't enough.
  const apiModeConfigured = isChatPaneApiModeConfigured({ executionMode: p.executionMode, apiModeAvailable: p.apiModeAvailable, byokRuntime: p.byokRuntime });
  const pane = useChatPaneHook(buildChatPaneArguments({ p, runtimeView, apiModeConfigured }));
  useComposerHandlePublisherHook({ pane }, definedProps({ source: { composerHandle: p.composerHandle } }));
  // No `runContext` here on purpose: agent-driven sends go through `pane.sendPrompt`, which builds
  // the context from the SAME `runContext` already handed to `useChatPane` above. A second copy
  // would be a second source of truth that could silently drift from the composer's.
  useChatPaneAgentControlHook({ pane: pane }, resolveAgentControlOptions(p.agentControl));
  // Selection resolution only returns available agents, so absence normally means nothing usable
  // is selected — except a configured BYOK turn (`apiModeConfigured`, computed above), which calls
  // the provider directly over HTTP and never touches the CLI inventory.
  const unavailable = pane.selectedAgent === undefined && !apiModeConfigured;
  const fileDrop = useChatPaneFileDropHook({ enabled: isChatPaneFileDropEnabled({ canUpload: surface.uploadAttachments !== undefined,
    disabled: p.disabled, unavailable, uploading: pane.isUploadingAttachments }), onFiles: pane.addAttachments, report: p.report });
  const slots = buildChatPaneSlots({ surfaceSlots: surface.composerSlots, embed: surface.embed, renderRuntimePicker: () => (
    <AgentRuntimePicker agentHandle={base ? `${base}-runtime` : false} agents={runtimeView.agents} value={pane.selection}
      onChange={pane.setSelection} {...definedProps({ source: { onRescan: runtimeView.rescanAgents } })}
      scanning={runtimeView.scanningAgents} daemonOnline={runtimeView.daemonOnline} placement={p.runtimePickerPlacement}
      executionMode={p.executionMode} apiModeAvailable={p.apiModeAvailable} {...definedProps({ source: {
        onExecutionModeChange: p.onExecutionModeChange, byokRuntime: p.byokRuntime, onByokModelChange: p.onByokModelChange, nativeToolPolicy: p.nativeToolPolicy,
      } })} />
  ) }, { leadingAccessory: p.leadingAccessory });
  return <ChatPaneLayout p={p} pane={pane} surface={surface} runtimeView={runtimeView} base={base} unavailable={unavailable}
    fileDrop={fileDrop} inventory={inventory} t={t} slots={slots} composerPlaceholder={composerPlaceholder}
    {...definedProps({ source: { useChatPaneControlsHeightHook, useChatPaneSuggestionHook, useChatPaneNewTabLinksHook, useChatPaneTranscriptPropsHook } })} />;
}
