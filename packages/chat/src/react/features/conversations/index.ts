/**
 * `@jini-ai/chat/react/conversations` — persisted conversation threads behind an injected store:
 * the framework-free controller, its React binding, and the inline delete confirmation.
 */
export { createConversationController } from './conversation-controller.js';
export { useStoredConversations } from './hooks/useStoredConversations.hooks.js';
export { useConversationDeleteConfirmation } from './hooks/useConversationDeleteConfirmation.hooks.js';
export type {
  ConversationController,
  ConversationDeleteConfirmationState,
  ConversationLog,
  ConversationState,
  ConversationStorePort,
  ConversationSummaryLike,
  UseStoredConversations,
} from './types.js';
