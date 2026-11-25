/**
 * @file The chat library's components and run-following values the admin kit restates: the chat pane, its
 * settings dialog and provider, the conversation switcher, the two ext-event cards, the frontend-session
 * bridge and the attachment uploader. Each prop list restates only what the admin dock passes (never
 * the chat package's whole prop surface), so a host's real component stays assignable. Split out of
 * `kit-chat-types.ts` only for size; `./react/kit` re-states them, nothing else imports this file.
 */
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { SurfaceEmission } from '@jini-ai/core';
import type { NativeToolPolicyInput } from '@jini-ai/core/contracts/agents';
import type {
  A2uiSurfaceCardProps, AssistantConversation, ChatAttachment, ChatMessage, ChatPaneAgent, ChatPaneAgentSelection, ChatPaneComposerHandle,
  ChatPaneRuntimeAccess, ChatPaneWorkingDirectoryAccess, ChatTransport, ComposerDiscoveryGroup, ComposerDiscoveryOutcome, ComposerDiscoverySelection,
  ExtEventRenderProps, ExtEventRendererRegistry, I18nAdapter, KitDeliverMidRunMessage, KitDeliverTypedAnswer,
  KitSecretRedactionSignal, KitRedactUserText,
} from './kit-chat-types.js';

/** One daemon-relayed capability invocation the pane executes and answers. */
export interface KitChatPaneAgentToolAction { readonly invocationId: string; readonly capabilityId: string; readonly input: Record<string, unknown> }
/** The channel connecting a pane to the daemon-side transports (the frontend-session bridge's `bridgeAccess`). */
export interface KitChatPaneAgentBridgeAccess {
  subscribe: (onAction: (action: KitChatPaneAgentToolAction) => void) => () => void;
  respondSuccess: (invocationId: string, output: unknown) => Promise<void>;
  respondError: (invocationId: string, message: string) => Promise<void>;
}
export interface KitChatPaneAgentControlOptions { enabled?: boolean; bridgeAccess?: KitChatPaneAgentBridgeAccess; webmcp?: boolean }
export interface KitChatPaneRunContextInput { prompt: string; selection: ChatPaneAgentSelection; workingDirectory: string | null }
/** The opaque per-run context the daemon receives, or a builder of it from the composer's state. */
export type KitChatPaneRunContext = Record<string, unknown> | ((input: KitChatPaneRunContextInput) => Record<string, unknown> | undefined);
export interface KitByokRuntimeSummary { providerLabel?: string; model?: string; iconId?: string; models?: readonly { id: string; label: string }[] }
export interface KitChatPaneAttachmentUploadOptions { signal: AbortSignal; batchId: string }
export type KitUploadAttachments = (files: File[], options?: KitChatPaneAttachmentUploadOptions) => Promise<ChatAttachment[]>;
/** The composer's slots the dock fills: the discovery menu and the footer's leading accessory. */
export interface KitChatPaneComposerSlots {
  discoveryGroups?: readonly ComposerDiscoveryGroup[];
  onDiscoverySelect?: (selection: ComposerDiscoverySelection) => void | ComposerDiscoveryOutcome | Promise<void | ComposerDiscoveryOutcome>;
  footerLeadingAccessory?: ReactNode;
}
export type KitToolCallDisplay = 'show' | 'collapsed' | 'hidden';
/** The chat pane's props the admin dock passes (a structural subset of the chat library's own). */
export interface KitChatPaneProps {
  transport: ChatTransport; sendingLabel?: string | undefined; nativeToolPolicy?: NativeToolPolicyInput; agents?: readonly ChatPaneAgent[];
  runtimeAccess?: ChatPaneRuntimeAccess; title?: string; initialMessages?: ChatMessage[];
  refreshSignal?: { loadMessages: () => Promise<ChatMessage[]>; visibility: EventTarget & { readonly visibilityState: string }; focus: EventTarget };
  conversationId?: string | null; selection?: ChatPaneAgentSelection; onSelectionChange?: (selection: ChatPaneAgentSelection) => void;
  runContext?: KitChatPaneRunContext; agentControl?: KitChatPaneAgentControlOptions; onMessagesChange?: (messages: ChatMessage[]) => void;
  subscribeToSurfaces?: (listener: (emission: SurfaceEmission) => void) => () => void;
  onRescanAgents?: () => void; scanningAgents?: boolean; daemonOnline?: boolean; executionMode?: 'local' | 'api'; apiModeAvailable?: boolean;
  onExecutionModeChange?: (mode: 'local' | 'api') => void; byokRuntime?: KitByokRuntimeSummary; onByokModelChange?: (model: string) => void;
  composerHistoryScope?: string; validateAttachments?: (attachments: readonly ChatAttachment[]) => Promise<readonly ChatAttachment[]>;
  composerHandle?: RefObject<ChatPaneComposerHandle | null>; deliverTypedAnswer?: KitDeliverTypedAnswer; deliverMidRunMessage?: KitDeliverMidRunMessage;
  redactUserText?: KitRedactUserText; onSecretRedacted?: (signal: KitSecretRedactionSignal) => void; placeholder?: string;
  workingDirectoryAccess?: ChatPaneWorkingDirectoryAccess; workingDirectoryControlPlacement?: 'below' | 'composer' | 'none';
  toolCallDisplay?: KitToolCallDisplay; showUsageLine?: boolean; showThinking?: boolean; agentPluginsMode?: 'auto' | 'ask' | 'off';
  uploadAttachments?: KitUploadAttachments; attachmentAccept?: string; composerSlots?: KitChatPaneComposerSlots;
  header?: ReactNode; leadingAccessory?: ReactNode; footer?: ReactNode; className?: string; style?: CSSProperties;
}
export interface KitChatSettingsSection {
  key: string; label?: string; description?: string; tooltip?: string;
  items: readonly { key: string; label: string; role?: string; checked?: boolean; hint?: string; tooltip?: string; disabled?: boolean; onSelect?: () => void }[];
}
export interface KitChatPermissionsPort {
  enabled: boolean; canEdit: boolean; busy?: boolean; error?: string | null; unavailableReason?: string;
  capabilities: readonly { key: string; label: string; description: string; enabled: boolean }[];
  onChange(input: { key?: string; enabled: boolean }): void;
}
export interface KitChatSettingsDialogProps {
  open: boolean; onClose: () => void; displaySections: readonly KitChatSettingsSection[]; permissions: KitChatPermissionsPort; t?: (key: string) => string;
}
export interface KitJiniChatProviderProps {
  transport: ChatTransport; i18n?: I18nAdapter; extEventRendererRegistry?: ExtEventRendererRegistry; children: ReactNode;
}
export type KitConversationListItem = Pick<AssistantConversation, 'id' | 'title'> & { messageCount?: number; updatedAt?: number };
export interface KitConversationListProps {
  report?: { error: (...args: never[]) => void } | undefined; conversations: KitConversationListItem[]; activeConversationId: string | null;
  onSelect: (id: string) => void; onCreate: () => void | Promise<void>; onDelete?: (id: string) => void | Promise<void>;
  onRename?: (id: string, title: string) => void | Promise<void>; onSearch?: (query: string) => Promise<KitConversationListItem[]>;
  confirmDelete?: (item: KitConversationListItem) => boolean | Promise<boolean>; createDisabled?: boolean; emptyState?: ReactNode;
  triggerLabel?: string; nativeTitle?: boolean;
  /** The switcher's own list-view hooks, forwarded untouched: the admin kit never calls them, so it keeps them opaque
   *  and the host's component narrows them to its real type. Absent means the host component's defaults. */
  hooks?: KitConversationListHooks | undefined;
  /** Row ticking and pinning, when the host injects them (see `DockHeader`'s `conversationTools`). */
  selectable?: boolean | undefined; selectedIds?: readonly string[] | undefined;
  onTogglePin?: ((required: { id: string; pinned: boolean }) => void) | undefined;
  onSelectionChange?: ((required: { ids: string[] }) => void) | undefined;
}
/** Opaque list-view hooks a host's conversation switcher understands; see {@link KitConversationListProps.hooks}. */
export type KitConversationListHooks = object;
export interface KitChatSettingsSegmentedProps {
  name: string; items: readonly { key: string; label: string; checked?: boolean | undefined; disabled?: boolean | undefined; change: () => void }[];
  inputRole?: 'menuitemradio' | undefined; checkedRef?: ((input: HTMLInputElement | null) => void) | undefined;
}
export interface KitSurfaceExpiryClock { nowMs(): number; every(intervalMs: number, tick: () => void): () => void }
/** What a View asks the host to run; structurally the protocol's `McpUiToolCall`. */
export interface KitMcpUiToolCall { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }
export interface KitMcpUiSurfaceCardProps extends ExtEventRenderProps {
  sandboxProxyUrl: URL; onToolCall?: (call: KitMcpUiToolCall) => Promise<unknown> | unknown; onOpenLink?: (url: string) => void;
  maxHeight?: number | undefined; expiryClock?: KitSurfaceExpiryClock;
}
/** The a2ui card's props: the ext-event props, the agent-action relay and the host clock. The component registry stays
 *  host-side (a host wrapper that owns one imports the chat card directly), so the kit does not restate it. */
export interface KitA2uiSurfaceCardProps extends A2uiSurfaceCardProps { clock: { nowMs(): number } }
export interface KitDaemonAttachmentUploaderOptions {
  readonly maxAttachmentBytes?: number; readonly maxAttachmentCount?: number; readonly maxBatchBytes?: number; readonly timeoutMs?: number; readonly concurrency?: number;
}
/** The browser half of the daemon's frontend-session channel; `bridgeAccess` goes to the pane's `agentControl`. */
export interface FrontendSessionBridge {
  readonly bridgeAccess: KitChatPaneAgentBridgeAccess;
  readonly ready: Promise<{ sessionId: string; bindToken: string }>;
  rebind(required?: { signal?: AbortSignal | undefined }, optional?: Record<string, never>): Promise<{ sessionId: string; bindToken: string }>;
  bindToken(): string | undefined;
  close(): void;
}
