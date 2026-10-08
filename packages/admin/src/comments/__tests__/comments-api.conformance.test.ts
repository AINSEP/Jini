import { describe, expect, it } from 'vitest';
import { createMemoryCommentsApi } from '../adapters/memory.js';
import { runCommentsApiConformance } from '../conformance/comments-api.conformance.js';
import type { AdminComment } from '../../core/ports/comments.js';

describe('Comments API memory conformance', () => {
  it('passes the framework-free checklist', async () => {
    const seed: AdminComment = { id: 'c1', entryId: 'e1', parentId: null, threadRootId: 'c1',
      depth: 0, status: 'pending', authorPrincipalId: null, authorName: 'Reader', authorEmail: null,
      authorUrl: null, authorIpHash: null, bodyText: 'Hello', spamScore: null, spamProvider: null,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 };
    const api = createMemoryCommentsApi({ items: [seed, { ...seed, id: 'c2', threadRootId: 'c2' }] });
    const checks = await runCommentsApiConformance({ api }, {});
    expect(checks).toHaveLength(21);
  });
});
