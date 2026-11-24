import { describe, expect, it } from 'vitest';
import { toolMetadata as imageTransform } from '../image-transform.js';
import { toolMetadata } from '../post.js';

/** Post tool approvals: deleting is a policy-confirmed trash, reads never prompt, writes are direct edits. */
describe('post tool metadata', () => {
  it('pins content_post_delete to a policy-confirmed trash', () => {
    expect(toolMetadata.content_post_delete.approval).toEqual({ class: 'trash', confirmation: 'policy' });
  });

  it('pins create/update as direct edits and get/list/search as direct reads', () => {
    expect(toolMetadata.content_post_create.approval).toEqual({ class: 'edit', confirmation: 'direct' });
    expect(toolMetadata.content_post_update.approval).toEqual({ class: 'edit', confirmation: 'direct' });
    for (const id of ['content_post_get', 'content_post_list', 'content_post_search', 'content_stats'] as const) {
      expect(toolMetadata[id].approval).toEqual({ class: 'read', confirmation: 'direct' });
    }
  });
});

describe('image-transform tool metadata', () => {
  it('pins image_transform to an edit confirmed through policy', () => {
    expect(imageTransform.image_transform.approval).toEqual({ class: 'edit', confirmation: 'policy' });
  });
});
