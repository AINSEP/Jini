/**
 * @jini-ai/chat-react — headless hooks + presentational components + slots for
 * a chat/artifact frontend, built on `@jini-ai/chat/core`'s framework-free
 * vocabulary. See foundry/docs/jini-port/recon/r4b-webui-design.md §1/§2/§4 for the
 * spec this package implements, and source-map.md for provenance.
 *
 * This barrel is filled in incrementally as each layer lands (hooks first,
 * then presentational components, then the `<JiniChatProvider>` composition
 * root) — see source-map.md's "Status" section for what's shipped so far.
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
} from '@jini-ai/chat/core';
export * from './artifact-types.js';
export * from './slots.js';
export * from './tool-renderer-registry.js';
export * from './ext-event-renderer-registry.js';

// `features/model-picker/` is an independent slice (depends only on
// `@jini-ai/protocol`, not this package's conversation/message state) —
// re-exported here for a consumer that wants everything from one barrel.
export * from './features/model-picker/index.js';
export * from './features/chat-pane/index.js';

export * from './hooks/useRunStream.js';
export * from './hooks/useConversation.js';
export * from './hooks/useComposer.js';
export * from './hooks/useToolTimeline.js';
export * from './hooks/useExtEventGroups.js';
export * from './hooks/usePinnedTodos.js';
export * from './hooks/useQuestionForms.js';
export * from './hooks/useArtifactStream.js';
export * from './hooks/useChatFabDrag.js';
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
export type { A2uiSurfaceCardProps } from './components/A2uiSurfaceCard.js';
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
