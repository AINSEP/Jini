import { token } from '@jini-ai/core';
import type { CommentThreadRendererPort, CommentModerationPort, CommentSubmissionPort, CommentsSelectionStorePort } from './ports.js';
import type { CommentsProviderRegistry } from './registry.js';
export const CommentsProviderRegistryToken = token<CommentsProviderRegistry>({ id: 'jini.capabilityProviders.comments.registry' });
export const CommentThreadRendererToken = token<CommentThreadRendererPort>({ id: 'jini.capabilityProviders.comments.renderer' });
export const CommentModerationToken = token<CommentModerationPort>({ id: 'jini.capabilityProviders.comments.moderation' });
export const CommentSubmissionToken = token<CommentSubmissionPort>({ id: 'jini.capabilityProviders.comments.submission' });
export const CommentsSelectionStoreToken = token<CommentsSelectionStorePort>({ id: 'jini.capabilityProviders.comments.selectionStore' });
