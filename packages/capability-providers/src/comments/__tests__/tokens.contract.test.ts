import { describe, expect, it } from 'vitest';

import * as tokens from '../tokens.js';

/** DI token ids are a cross-package contract (a host binds by id); Stryker L6 found every token
 * options object replaceable by `{}`. */
describe('comments DI tokens', () => {
  it('each token has its stable id, version 1 and cardinality one', () => {
    expect({ ...tokens }).toEqual({
      CommentModerationToken: { id: 'jini.capabilityProviders.comments.moderation', version: 1, cardinality: 'one' },
      CommentSubmissionToken: { id: 'jini.capabilityProviders.comments.submission', version: 1, cardinality: 'one' },
      CommentThreadRendererToken: { id: 'jini.capabilityProviders.comments.renderer', version: 1, cardinality: 'one' },
      CommentsProviderRegistryToken: { id: 'jini.capabilityProviders.comments.registry', version: 1, cardinality: 'one' },
      CommentsSelectionStoreToken: { id: 'jini.capabilityProviders.comments.selectionStore', version: 1, cardinality: 'one' },
    });
  });
});
