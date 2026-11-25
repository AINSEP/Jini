import { describe, expect, it } from 'vitest';
import { createRevisionThinningRoutes, type RevisionThinningApplyDeps, type RevisionThinningPreviewDeps } from '../revision-thinning.js';

type Context = { owner: string; workspaceId: string };
const paths = { preview: '/revisions/preview', apply: '/revisions/apply' };

describe('revision thinning routes', () => {
  it('one spec resolves two requests to different trusted owners and scopes', async () => {
    const routes = createRevisionThinningRoutes<Context>({ paths });
    const calls: unknown[] = [];
    const deps: RevisionThinningPreviewDeps<Context> = {
      resolve: async ({ context, selection }) => {
        if (!context || typeof selection.postId !== 'string' || typeof selection.kind !== 'string') throw new Error('refused');
        return { principal: context.owner, scope: { workspaceId: context.workspaceId, postId: selection.postId, kind: selection.kind } };
      },
      refuse: ({ error }) => { throw error; },
      readOlderThan: () => 10,
      preview: async required => { calls.push(required); return { ids: ['old'], count: 1, previewToken: 'token' }; },
    };
    for (const id of ['a', 'b']) {
      const parsed = routes.preview.parse({ body: { postId: id, kind: 'post' }, params: {}, query: {} });
      if (!parsed.ok) throw new Error('parse failed');
      expect(await routes.preview.handle({ input: parsed.value, deps, context: { owner: `owner-${id}`, workspaceId: `ws-${id}` } }))
        .toEqual({ ok: true, value: { ids: ['old'], count: 1, previewToken: 'token' } });
    }
    expect(calls).toEqual(['a', 'b'].map(id => ({ principal: `owner-${id}`, scope: { workspaceId: `ws-${id}`, postId: id, kind: 'post' }, before: 10 })));
  });

  it('body cannot override workspace or principal', async () => {
    const routes = createRevisionThinningRoutes<Context>({ paths });
    const selections: unknown[] = [], calls: unknown[] = [];
    const disagreement = new Error('host selector disagreement');
    const deps: RevisionThinningPreviewDeps<Context> = {
      resolve: async ({ selection }) => {
        selections.push(selection);
        if (selection.params.postId !== undefined && selection.params.postId !== selection.postId) throw disagreement;
        return { principal: 'trusted', scope: { workspaceId: 'trusted-ws', postId: 'p', kind: 'post' } };
      },
      refuse: ({ error }) => { throw error; }, readOlderThan: () => 12,
      preview: async required => { calls.push(required); return { ids: [], count: 0, previewToken: 'token' }; },
    };
    const body = { postId: 'p', kind: 'post', workspaceId: 'forged', principal: 'forged', scope: { workspaceId: 'forged' } };
    const parsed = routes.preview.parse({ body, params: {}, query: {} });
    if (!parsed.ok) throw new Error('parse failed');
    await routes.preview.handle({ input: parsed.value, deps, context: { owner: 'trusted', workspaceId: 'trusted-ws' } });
    const conflicting = routes.preview.parse({ body, params: { postId: 'path-p' }, query: {} });
    if (!conflicting.ok) throw new Error('parse failed');
    await expect(routes.preview.handle({ input: conflicting.value, deps })).rejects.toBe(disagreement);
    expect(selections).toEqual([{ postId: 'p', kind: 'post', params: {} }, { postId: 'p', kind: 'post', params: { postId: 'path-p' } }]);
    expect(calls).toEqual([{ principal: 'trusted', scope: { workspaceId: 'trusted-ws', postId: 'p', kind: 'post' }, before: 12 }]);
  });

  it('apply requires literal confirmation before invoking the port', async () => {
    const routes = createRevisionThinningRoutes<Context>({ paths });
    const calls: unknown[] = [];
    const confirmationError = new Error('host confirmation wording'), missingTokenError = new Error('host token wording');
    let confirm: unknown = false, previewToken = 'token';
    const deps: RevisionThinningApplyDeps<Context> = {
      resolve: async () => ({ principal: 'trusted', scope: { workspaceId: 'ws', postId: 'p', kind: 'post' } }),
      refuse: ({ error }) => { throw error; }, confirmationError, missingTokenError,
      readApply: () => ({ previewToken, confirm }),
      apply: async required => { calls.push(required); return { deleted: ['old'], kept: [] }; },
    };
    const parsed = routes.apply.parse({ body: { postId: 'p', kind: 'post' }, params: {}, query: {} });
    if (!parsed.ok) throw new Error('parse failed');
    for (confirm of [false, 'true', 1, undefined]) {
      await expect(routes.apply.handle({ input: parsed.value, deps })).rejects.toBe(confirmationError);
    }
    confirm = true; previewToken = '';
    await expect(routes.apply.handle({ input: parsed.value, deps })).rejects.toBe(missingTokenError);
    expect(calls).toEqual([]);
    previewToken = 'token';
    expect(await routes.apply.handle({ input: parsed.value, deps })).toEqual({ ok: true, value: { deleted: ['old'], kept: [] } });
    expect(calls).toEqual([{ principal: 'trusted', scope: { workspaceId: 'ws', postId: 'p', kind: 'post' }, previewToken: 'token', confirm: true }]);
  });

  it('both writes require same origin', () => {
    const routes = createRevisionThinningRoutes<Context>({ paths });
    expect([routes.preview.method, routes.apply.method]).toEqual(['post', 'post']);
    expect([routes.preview.requireSameOrigin, routes.apply.requireSameOrigin]).toEqual([true, true]);
  });
});
