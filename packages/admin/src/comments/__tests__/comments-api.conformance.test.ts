import { describe, expect, it } from 'vitest';
import { createMemoryCommentsApi } from '../adapters/memory.js';
import { runCommentsApiConformance } from '../conformance/comments-api.conformance.js';
import type { AdminComment, AdminCommentsPort } from '../../core/ports/comments.js';

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

const SEED: AdminComment = { id: 'c1', entryId: 'e1', parentId: null, threadRootId: 'c1',
  depth: 0, status: 'pending', authorPrincipalId: null, authorName: 'Reader', authorEmail: null,
  authorUrl: null, authorIpHash: null, bodyText: 'Hello', spamScore: null, spamProvider: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 };

function memoryApi(items: readonly AdminComment[] = [SEED, { ...SEED, id: 'c2', threadRootId: 'c2' }]): AdminCommentsPort {
  return createMemoryCommentsApi({ items });
}

describe('runCommentsApiConformance', () => {
  it('returns the 21 named checks in order against a conforming adapter', async () => {
    expect(await runCommentsApiConformance({ api: memoryApi() })).toEqual([
      'status and limit filter',
      'cursor advances without repeating rows',
      'partial settings patch preserves siblings and null',
      'settings read your writes',
      'invalid settings patch rejects',
      'invalid settings patch is atomic',
      'approve has no response body',
      'approve changes status and increments version',
      'spam has no response body',
      'spam changes status and increments version',
      'trash has no response body',
      'trash changes status and increments version',
      'restore has no response body',
      'restore changes status and increments version',
      'earlier queue snapshot is unchanged',
      'stale version rejects with status and currentVersion',
      'cursor survives its marker leaving the status',
      'purge has no version guard or response body',
      'purge removes the row',
      'missing purge rejects',
      'missing moderation rejects',
    ]);
  });

  it('returns a frozen list', async () => {
    expect(Object.isFrozen(await runCommentsApiConformance({ api: memoryApi() }))).toBe(true);
  });

  it('restores the original settings after the run', async () => {
    const api = memoryApi();
    const before = await api.getCommentsSettings({});
    await runCommentsApiConformance({ api });
    expect(await api.getCommentsSettings({})).toEqual(before);
  });

  it('refuses a fixture with fewer than two pending comments', async () => {
    await expect(runCommentsApiConformance({ api: memoryApi([SEED]) }))
      .rejects.toThrow(new Error('Conformance needs at least two pending comments'));
  });

  it('refuses a fixture with no pending comments', async () => {
    await expect(runCommentsApiConformance({ api: memoryApi([]) }))
      .rejects.toThrow(new Error('Conformance needs at least two pending comments'));
  });

  it('fails the stale-version check when a stale moderation succeeds', async () => {
    const real = memoryApi();
    let moderations = 0;
    const api: AdminCommentsPort = { ...real, async moderateComment(required, optional) {
      moderations++;
      // The fifth moderation is the deliberately stale trash; this adapter wrongly accepts it.
      if (moderations === 5) return;
      return real.moderateComment(required, optional);
    } };
    await expect(runCommentsApiConformance({ api }))
      .rejects.toThrow(new Error('Comments API conformance: stale version rejects with status and currentVersion'));
  });

  it('fails the stale-version check when the conflict body lacks currentVersion', async () => {
    const real = memoryApi();
    const api: AdminCommentsPort = { ...real, async moderateComment(required, optional) {
      try {
        return await real.moderateComment(required, optional);
      } catch (e) {
        throw Object.assign(new Error('conflict'), { status: 409, body: {} }, { cause: e });
      }
    } };
    await expect(runCommentsApiConformance({ api }))
      .rejects.toThrow(new Error('Comments API conformance: stale version rejects with status and currentVersion'));
  });

  it('fails the invalid-settings check when an invalid patch is accepted', async () => {
    const real = memoryApi();
    const api: AdminCommentsPort = { ...real, async putCommentsSettings(required, patch = {}) {
      return patch.spamAutoRejectScore === 2 ? real.getCommentsSettings(required) : real.putCommentsSettings(required, patch);
    } };
    await expect(runCommentsApiConformance({ api }))
      .rejects.toThrow(new Error('Comments API conformance: invalid settings patch rejects'));
  });

  it('fails the atomicity check when a rejected patch is still applied', async () => {
    const real = memoryApi();
    const api: AdminCommentsPort = { ...real, async putCommentsSettings(required, patch = {}) {
      if (patch.spamAutoRejectScore !== 2) return real.putCommentsSettings(required, patch);
      await real.putCommentsSettings(required, { spamAutoRejectScore: 1 });
      throw new Error('rejected after a partial write');
    } };
    await expect(runCommentsApiConformance({ api }))
      .rejects.toThrow(new Error('Comments API conformance: invalid settings patch is atomic'));
  });

  it('fails the first check when the limit is ignored', async () => {
    const real = memoryApi([SEED, { ...SEED, id: 'c2', threadRootId: 'c2' }, { ...SEED, id: 'c3', threadRootId: 'c3' }]);
    const api: AdminCommentsPort = { ...real, async listCommentsQueue(required, options = {}) {
      const page = await real.listCommentsQueue(required, { ...options, limit: 2 });
      return page;
    } };
    await expect(runCommentsApiConformance({ api }))
      .rejects.toThrow(new Error('Comments API conformance: status and limit filter'));
  });

  it('fails the purge-removal check when purge leaves the row', async () => {
    const real = memoryApi();
    const api: AdminCommentsPort = { ...real, async purgeComment() { /* accepts but never removes */ } };
    await expect(runCommentsApiConformance({ api }))
      .rejects.toThrow(new Error('Comments API conformance: purge removes the row'));
  });
});
