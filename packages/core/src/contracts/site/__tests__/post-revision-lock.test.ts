import { expect, it } from 'vitest';
import { postRevisionLockKey } from '../post-revision-lock.js';

it('includes workspace and post in the shared revision fence', () => {
  expect(postRevisionLockKey({ workspaceId: 'workspace-7', postId: 'post-9' })).toBe('post_revisions:workspace-7:post-9');
});
