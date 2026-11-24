---
"@jini-ai/capability-providers": major
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

The comments provider contract types (`CommentsProviderAdapter`, `CommentsProviderDefinition`, `CommentsProviderBinding`, `CommentsProviderRegistry`, `CommentsSelection`, `CommentsSelectionStorePort`, `CommentsSettingField`, `CommentThreadRendererPort`, `CommentThreadScript`, `CommentModerationPort`, `CommentSubmissionPort`, `CommentStatus`) are no longer exported from `@jini-ai/capability-providers/comments`; import them from `@jini-ai/core/contracts/site/comments-providers`. `createCommentsProviderRegistry`, `freezeCommentsDefinition` and the tokens stay in capability-providers. `@jini-ai/cms` gains `comments/site/settings`, `comments/site/builtin-provider` and `comments/site/provider-selection`; the host injects the provider-registry factory and the settings principal-lookup binding.
