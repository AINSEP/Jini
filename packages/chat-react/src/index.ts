/**
 * @jini-ai/chat-react — headless hooks + presentational components + slots for
 * a chat/artifact frontend, built on `@jini-ai/chat-core`'s framework-free
 * vocabulary. See foundry/docs/jini-port/recon/r4b-webui-design.md §1/§2/§4 for the
 * spec this package implements, and source-map.md for provenance.
 *
 * This barrel is filled in incrementally as each layer lands (hooks first,
 * then presentational components, then the `<JiniChatProvider>` composition
 * root) — see source-map.md's "Status" section for what's shipped so far.
 */
export * from './transport.js';
export * from './artifact-types.js';
export * from './slots.js';
export * from './tool-renderer-registry.js';
export * from './ext-event-renderer-registry.js';

// `features/model-picker/` is an independent slice (depends only on
// `@jini-ai/agent-runtime`, not this package's conversation/message state) —
// re-exported here for a consumer that wants everything from one barrel.
export * from './features/model-picker/index.js';
export * from './features/chat-pane/index.js';

export * from './react/hooks/useRunStream.js';
export * from './react/hooks/useConversation.js';
export * from './react/hooks/useComposer.js';
export * from './react/hooks/useToolTimeline.js';
export * from './react/hooks/useExtEventGroups.js';
export * from './react/hooks/usePinnedTodos.js';
export * from './react/hooks/useQuestionForms.js';
export * from './react/hooks/useArtifactStream.js';
export {
  useT,
  useI18n,
  useAnalytics,
  useProjectContext,
  useChatTransport,
  useArtifactRegistry,
} from './react/hooks/context.js';

export { TodoCard } from './react/components/TodoCard.js';
export type { TodoCardProps } from './react/components/TodoCard.js';
export { ToolCard } from './react/components/ToolCard.js';
export type { ToolCardProps } from './react/components/ToolCard.js';
export { A2uiSurfaceCard } from './react/components/A2uiSurfaceCard.js';
export type { A2uiSurfaceCardProps } from './react/components/A2uiSurfaceCard.js';
export { QuestionForm } from './react/components/QuestionForm.js';
export type { QuestionFormProps, QuestionFormHandle, QuestionFormFileSubmission } from './react/components/QuestionForm.js';
export { QuestionsPanel } from './react/components/QuestionsPanel.js';
export type { QuestionsPanelProps } from './react/components/QuestionsPanel.js';
export { NextStepActions } from './react/components/NextStepActions.js';
export type { NextStepAction, NextStepActionsProps } from './react/components/NextStepActions.js';
export { Markdown } from './react/components/Markdown.js';
export type { MarkdownProps } from './react/components/Markdown.js';
export { MessageRow } from './react/components/MessageRow.js';
export type { MessageRowProps } from './react/components/MessageRow.js';
export { MessageList } from './react/components/MessageList.js';
export type { MessageListProps } from './react/components/MessageList.js';
export { Composer } from './react/components/Composer.js';
export type { ComposerProps } from './react/components/Composer.js';
export { AttachmentTray } from './react/components/AttachmentTray.js';
export type { AttachmentTrayProps } from './react/components/AttachmentTray.js';
export { JiniChatProvider, useJiniChatSlots, useOnFeedback } from './react/components/JiniChatProvider.js';
export type { JiniChatProviderProps, JiniChatSlots } from './react/components/JiniChatProvider.js';

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
