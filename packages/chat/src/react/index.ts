/**
 * @jini-ai/chat-react — headless hooks + presentational components + slots for
 * a chat/artifact frontend, built on `@jini-ai/chat/core`'s framework-free
 * vocabulary. See ADS-memory/reports/jini-port/recon/r4b-webui-design.md §1/§2/§4 for the
 * spec this package implements, and source-map.md for provenance.
 *
 * This barrel is filled in incrementally as each layer lands (hooks first,
 * then presentational components, then the `<JiniChatProvider>` composition
 * root) — see source-map.md's "Status" section for what's shipped so far.
 *
 * ## Every export here is explicit. Do not reintroduce `export *`.
 *
 * This file used 15 `export * from` statements until 2026-08-05. That made the package's public
 * API *implicit*: whatever any of those modules happened to export was public, so renaming an
 * internal helper shipped a breaking change nobody reviewed, and no one could read this file and
 * say what the package exports. It is also the likeliest reason consumers reach past this barrel
 * into `@jini-ai/chat/core` deep paths — a grab-bag invites bypassing.
 *
 * The expansion was mechanical and provably surface-preserving: 193 symbols before and after,
 * identical in name AND in value-vs-type kind. `features/chat-pane/index.ts` is the style model.
 *
 * When adding an export, add the name here deliberately. That edit IS the API review.
 */
// The `ChatTransport` port moved to `@jini-ai/chat/core` on 2026-07-29 (it is pure types over
// `AbortSignal`, so a non-React host should not need this package to name the seam it implements).
// Re-exported here so every existing `import { ChatTransport } from '@jini-ai/chat-react'` keeps
// working; new code should import it from `@jini-ai/chat/core` directly.
export type {
  ChatTransport,
  FeedbackChange,
  OnFeedback,
  ReattachRunOptions,
  RunContext,
  RunHandlers,
  StartRunInput,
} from '../core/index.js';
export {
  RendererRegistry,
} from './artifact-types.js';
export type {
  ArtifactFile,
  ArtifactRenderContext,
  ArtifactRenderMatch,
  ArtifactRenderer,
} from './artifact-types.js';
export type {
  AgentOption,
  AgentSelection,
  AnalyticsAdapter,
  AnnotationAdapter,
  AttachmentTraySlot,
  ComposerPlusItem,
  ComposerSlots,
  FilePreviewSlot,
  I18nAdapter,
  MentionResult,
  MentionSource,
  ModelAgentPickerSlot,
  ProjectContextValue,
} from './slots.js';
export {
  clearToolRenderers,
  getToolRenderer,
  registerToolRenderer,
} from './tool-renderer-registry.js';
export type {
  ToolRenderer,
} from './tool-renderer-registry.js';
export {
  clearExtEventRenderers,
  getExtEventRenderer,
  registerExtEventRenderer,
} from './ext-event-renderer-registry.js';
export type {
  ExtEventRenderProps,
  ExtEventRenderer,
} from './ext-event-renderer-registry.js';

// `features/model-picker/` is an independent slice (depends only on
// `@jini-ai/protocol`, not this package's conversation/message state) —
// re-exported here for a consumer that wants everything from one barrel.
export {
  CREDENTIAL_STATUS_SORT_PRIORITY,
  CredentialStatusBadge,
  DEFAULT_MIN_SEARCHABLE_OPTIONS,
  ModelPicker,
  defaultModelPickerPort,
  filterModelGroups,
  findSelectedModel,
  firstAvailableModelId,
  groupModelsByProvider,
  isCustomModelId,
  matchesModelQuery,
  modelSubtitle,
  useModelPicker,
} from './features/model-picker/index.js';
export type {
  AgentDefinition,
  AgentDiagnostic,
  CredentialStatus,
  CredentialStatusBadgeProps,
  FetchProviderModelsInput,
  FetchProviderModelsResult,
  ModelOption,
  ModelPickerController,
  ModelPickerGroup,
  ModelPickerPort,
  ModelPickerProps,
  ModelPickerSelection,
  ModelProvider,
  UseModelPickerOptions,
} from './features/model-picker/index.js';
export {
  AgentRuntimePicker,
  CHAT_PANE_AGENT_TOOLS,
  ChatPane,
  createDaemonAttachmentUploader,
  createMcpUiToolCaller,
  defaultChatPaneSelection,
  orderChatPaneAgents,
  resolveChatPaneSelection,
  useChatPane,
  useChatPaneAgentControl,
  useChatPaneRuntimeInventory,
  useChatPaneWorkingDirectory,
} from './features/chat-pane/index.js';
export type {
  AgentRuntimePickerProps,
  ByokRuntimeSummary,
  ChatPaneActivity,
  ChatPaneAgent,
  ChatPaneAgentBridgeAccess,
  ChatPaneAgentControlOptions,
  ChatPaneAgentOption,
  ChatPaneAgentSelection,
  ChatPaneAgentToolAction,
  ChatPaneAgentToolDef,
  ChatPaneAgentToolInputSchema,
  ChatPaneAgentToolRisk,
  ChatPaneAttachmentUploadOptions,
  ChatPaneProps,
  ChatPaneRunContext,
  ChatPaneRunContextInput,
  ChatPaneRuntimeAccess,
  ChatPaneVariant,
  ChatPaneWorkingDirectoryAccess,
  CreateDaemonAttachmentUploaderOptions,
  CreateMcpUiToolCallerOptions,
  McpUiToolCallRequest,
  RuntimePickerPlacement,
  UseChatPaneAgentControlOptions,
  UseChatPaneOptions,
  UseChatPaneResult,
  UseChatPaneRuntimeInventoryOptions,
  UseChatPaneRuntimeInventoryResult,
  UseChatPaneWorkingDirectoryOptions,
  UseChatPaneWorkingDirectoryResult,
} from './features/chat-pane/index.js';

export {
  useRunStream,
} from './hooks/useRunStream.js';
export type {
  RunStreamState,
  RunStreamStatus,
  StartRunOptions,
  UseRunStreamResult,
} from './hooks/useRunStream.js';
export {
  useConversation,
} from './hooks/useConversation.js';
export type {
  SendMessageOptions,
  UseConversationOptions,
  UseConversationResult,
} from './hooks/useConversation.js';
export {
  useComposer,
} from './hooks/useComposer.js';
export type {
  ComposerDraftPersistence,
  MentionPopoverState,
  UseComposerOptions,
  UseComposerResult,
} from './hooks/useComposer.js';
export {
  useToolTimeline,
} from './hooks/useToolTimeline.js';
export type {
  ToolTimelineRow,
  UseToolTimelineOptions,
  UseToolTimelineResult,
} from './hooks/useToolTimeline.js';
export {
  useExtEventGroups,
} from './hooks/useExtEventGroups.js';
export type {
  ExtEventGroup,
} from './hooks/useExtEventGroups.js';
export {
  usePinnedTodos,
} from './hooks/usePinnedTodos.js';
export type {
  UsePinnedTodosResult,
} from './hooks/usePinnedTodos.js';
export {
  parseSubmittedAnswers,
  useQuestionForms,
} from './hooks/useQuestionForms.js';
export type {
  ParsedQuestionForm,
  QuestionFormAnswers,
  UseQuestionFormsResult,
} from './hooks/useQuestionForms.js';
export {
  useArtifactStream,
} from './hooks/useArtifactStream.js';
export type {
  ArtifactStreamItem,
  UseArtifactStreamResult,
} from './hooks/useArtifactStream.js';
export {
  CHAT_FAB_DRAG_THRESHOLD_PX,
  CHAT_FAB_EDGE_MARGIN_PX,
  clampChatFabToViewport,
  useChatFabDrag,
} from './hooks/useChatFabDrag.js';
export type {
  ChatFabPosition,
  UseChatFabDragResult,
} from './hooks/useChatFabDrag.js';
export {
  useT,
  useI18n,
  useAnalytics,
  useProjectContext,
  useChatTransport,
  useArtifactRegistry,
} from './hooks/context.js';

export { TodoCard } from './components/TodoCard.js';
export type { TodoCardProps } from './components/TodoCard.js';
/**
 * The conversation switcher — new / select / delete / search / rename-on-double-click. Storage
 * agnostic: it takes data plus callbacks, so a host backs it with `@jini-ai/sqlite`'s
 * `ChatHistoryStore`, an HTTP endpoint, or a plain array. Drop it into `ChatPane`'s
 * `leadingAccessory` slot; it needs no changes to `ChatPane` itself.
 */
export { ConversationList } from './components/ConversationList.js';
export type { ConversationListProps, ConversationListItem } from './components/ConversationList.js';
export { ToolCard } from './components/ToolCard.js';
export type { ToolCardProps } from './components/ToolCard.js';
export { A2uiSurfaceCard } from './components/A2uiSurfaceCard.js';
// `A2uiAgentActionOutcome` is public on `A2uiSurfaceCardProps.onAgentAction`'s return type but was
// not itself exported, so a host implementing that handler had no way to name its own return type.
export type { A2uiAgentActionOutcome, A2uiSurfaceCardProps } from './components/A2uiSurfaceCard.js';
/**
 * Moved from `@jini-ai/ui`'s `react/mcp-ui/` 2026-08-03 (see `McpUiSurfaceCard.tsx`'s own file
 * doc) — the same `kind: 'ext'` extensibility seam as `A2uiSurfaceCard` above, just for MCP-UI
 * resources instead of A2UI surfaces.
 */
export { McpUiSurfaceCard, registerMcpUiSurfaceRenderer, MCP_UI_EXT_EVENT_NAME } from './components/McpUiSurfaceCard.js';
export type { McpUiSurfaceCardProps } from './components/McpUiSurfaceCard.js';
export { ExtEventErrorBoundary } from './components/ExtEventErrorBoundary.js';
export type { ExtEventErrorBoundaryProps } from './components/ExtEventErrorBoundary.js';
export { QuestionForm } from './components/QuestionForm.js';
export type { QuestionFormProps, QuestionFormHandle, QuestionFormFileSubmission } from './components/QuestionForm.js';
export { QuestionsPanel } from './components/QuestionsPanel.js';
export type { QuestionsPanelProps } from './components/QuestionsPanel.js';
export { NextStepActions } from './components/NextStepActions.js';
export type { NextStepAction, NextStepActionsProps } from './components/NextStepActions.js';
export { Markdown } from './components/Markdown.js';
export type { MarkdownProps } from './components/Markdown.js';
export { MessageRow } from './components/MessageRow.js';
export type { MessageRowProps } from './components/MessageRow.js';
export { MessageList } from './components/MessageList.js';
export type { MessageListProps } from './components/MessageList.js';
export { Composer } from './components/Composer.js';
export type { ComposerProps } from './components/Composer.js';
export { AttachmentTray } from './components/AttachmentTray.js';
export type { AttachmentTrayProps } from './components/AttachmentTray.js';
export { ChatFab } from './components/ChatFab.js';
export type { ChatFabProps } from './components/ChatFab.js';
export { JiniChatProvider, useJiniChatSlots, useOnFeedback } from './components/JiniChatProvider.js';
export type { JiniChatProviderProps, JiniChatSlots } from './components/JiniChatProvider.js';

/**
 * Agent bridge — the browser half of daemon-relayed frontend control.
 *
 * Lives here rather than in an example because a consumer cannot copy-paste its way to a
 * transport: this is the piece that makes `ChatPaneAgentBridgeAccess` satisfiable at all.
 *
 * `createDomPageDriver`/`currentAgentPage` moved to `@jini-ai/agentic/dom` in the 2026-07-26
 * extraction — re-exported here so existing `@jini-ai/chat-react` importers keep working.
 */
export { createFrontendSessionBridge } from './agent-bridge/frontend-session-bridge.js';
export type {
  FrontendSessionBridge,
  FrontendSessionBridgeOptions,
} from './agent-bridge/frontend-session-bridge.js';
export { createDomPageDriver, currentAgentPage, type DomPageDriverOptions } from '@jini-ai/agentic/dom';
