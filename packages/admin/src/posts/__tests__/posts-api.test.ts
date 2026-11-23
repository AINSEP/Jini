import { describe, expect, it, vi } from 'vitest';
import { createPostsApi, type PostsApiDeps } from '../api/posts-api.js';

/** The client only names paths, methods and bodies over the injected collaborators. */
function bind(overrides: Partial<PostsApiDeps> = {}) {
  const request = vi.fn(async (..._args: unknown[]) => ({}));
  const deps: PostsApiDeps = {
    request: request as unknown as PostsApiDeps['request'],
    workspaceId: 'ws-1', base: '/api/x', siteUrl: ({ path }) => `https://site.test${path}`,
    bodyFitsKeepalive: () => true, ...overrides,
  };
  return { request, api: createPostsApi(deps) };
}

describe('createPostsApi', () => {
  it('scopes CRUD paths under the injected workspace and encodes ids', async () => {
    const { request, api } = bind();
    await api.listPosts();
    await api.getPost({ id: 'a/b' });
    await api.deletePost({ id: 'p1' });
    expect(request.mock.calls).toEqual([
      [{ path: '/workspaces/ws-1/posts' }],
      [{ path: '/workspaces/ws-1/posts/a%2Fb' }],
      [{ path: '/workspaces/ws-1/posts/p1' }, { init: { method: 'DELETE' } }],
    ]);
  });

  it('reports update failures under the page entry only when asked', async () => {
    const { request, api } = bind();
    await api.updatePost({ id: 'p1' }, { options: { title: 'T' }, entry: 'page' });
    await api.updatePost({ id: 'p1' });
    expect(request.mock.calls[0]).toEqual([{ path: '/workspaces/ws-1/posts/p1' }, { init: { method: 'PUT', body: '{"title":"T"}' }, onOk: undefined, options: { failureEntry: 'page' } }]);
    expect(request.mock.calls[1]![1]).toEqual({ init: { method: 'PUT', body: '{}' }, onOk: undefined, options: {} });
  });

  it('builds the template-preview URL through the injected base and siteUrl, keeping the tri-state', () => {
    const { api } = bind();
    expect(api.templatePreviewUrl({ id: 'p 1', templateChoice: null })).toBe('https://site.test/api/x/workspaces/ws-1/posts/p%201/template-preview');
    expect(api.templatePreviewUrl({ id: 'p1', templateChoice: '' })).toBe('https://site.test/api/x/workspaces/ws-1/posts/p1/template-preview?templateChoice=');
    expect(api.templatePreviewUrl({ id: 'p1', templateChoice: 'a b.html' })).toBe('https://site.test/api/x/workspaces/ws-1/posts/p1/template-preview?templateChoice=a%20b.html');
  });

  it('sends keepalive only when requested and the injected check says the body fits', async () => {
    const draft = { bodyFormat: 'html' as const, bodyHtml: '<p/>', title: 't', slug: 's', baseVersion: 2 };
    const fits = bind();
    await fits.api.putAutosave({ id: 'p1', draft }, { keepalive: true });
    await fits.api.putAutosave({ id: 'p1', draft });
    expect(fits.request.mock.calls[0]).toEqual([{ path: '/workspaces/ws-1/posts/p1/autosave' }, { init: { method: 'PUT', body: JSON.stringify(draft), keepalive: true } }]);
    expect(fits.request.mock.calls[1]![1]).toEqual({ init: { method: 'PUT', body: JSON.stringify(draft) } });
    const tooBig = bind({ bodyFitsKeepalive: () => false });
    await tooBig.api.putAutosave({ id: 'p1', draft }, { keepalive: true });
    expect(tooBig.request.mock.calls[0]![1]).toEqual({ init: { method: 'PUT', body: JSON.stringify(draft) } });
    await tooBig.api.getAutosave({ id: 'p1' });
    await tooBig.api.discardAutosave({ id: 'p1' });
    expect(tooBig.request.mock.calls.slice(1)).toEqual([
      [{ path: '/workspaces/ws-1/posts/p1/autosave' }],
      [{ path: '/workspaces/ws-1/posts/p1/autosave' }, { init: { method: 'DELETE' } }],
    ]);
  });
});
