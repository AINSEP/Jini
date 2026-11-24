/** Neutral comments contracts, metadata and site-scoped resolution. Hosts bind their own adapters. */
export * from './definitions.js';
/** Deprecated re-export: import these from `@jini-ai/core/contracts/site/capability-providers-comments`; removed at the next major. */
export type {
  CommentsSettingField, CommentsProviderDefinition, CommentStatus, CommentThreadScript, CommentThreadRendererPort, CommentModerationPort,
  CommentSubmissionPort, CommentsProviderAdapter, CommentsSelection, CommentsSelectionStorePort, CommentsProviderBinding, CommentsProviderRegistry,
} from "@jini-ai/core/contracts/site/capability-providers-comments";
export * from './registry.js';
export * from './tokens.js';
