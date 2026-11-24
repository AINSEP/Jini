import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { CommentRepoPort } from '../../ports.js';
import type { CommentRecord, CommentsSettings } from '../../types.js';
import { createBuiltinCommentsProvider, BUILTIN_COMMENTS_DEFINITION, type BuiltinCommentsDeps } from '../builtin-provider.js';
import { ToolInputError } from '@jini-ai/core';

const entry = { id: 'e', slug: 'post', title: 'Post', canonicalUrl: '/post', status: 'published' };
const row = (patch: Partial<CommentRecord> = {}): CommentRecord => ({ id: 'c', workspaceId: 's', entryId: 'e', parentId: null, threadRootId: 'c',
  depth: 0, status: 'approved', authorPrincipalId: null, authorName: 'Visitor', authorEmail: 'private@example.test', authorUrl: 'javascript:secret',
  authorIpHash: 'PRIVATE_IP_HASH', bodyText: 'Hello', spamScore: null, spamProvider: null, createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1, ...patch });
function fixture() {
  const calls: { query?: unknown; submit?: unknown; apply?: unknown; purge?: unknown; reads: number } = { reads: 0 };
  const settings: CommentsSettings = { enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null, spamAutoRejectScore: .5, maxPerIpPerHour: 20 };
  let items = [row()]; let nextCursor: string | null = null; let accepted = true;
  const deps: BuiltinCommentsDeps = { siteId: 's', ready: Promise.resolve(), getSettings: async () => settings,
    repo: { listModerationQueue: async input => { calls.query = input; calls.reads++; return { items, nextCursor }; },
      findById: async ({ id }) => items.find(item => item.id === id) ?? null } as CommentRepoPort,
    ingress: { submit: async input => { calls.submit = input; return accepted ? { ok: true, comment: row({ status: 'pending' }), autoClassified: 'pending' } : { ok: false, reason: 'honeypot-tripped' }; } },
    writes: { applyModeration: async input => { calls.apply = input; return { ok: true }; }, purge: async input => { calls.purge = input; return { ok: true }; } },
  };
  return { calls, settings, deps, provider: createBuiltinCommentsProvider(deps), items: (value: CommentRecord[]) => { items = value; },
    cursor: (value: string | null) => { nextCursor = value; }, reject: () => { accepted = false; } };
}

test('public SSR escapes the corpus, omits private fields and gates status/entry/site with one 200-row query', async () => {
  const f = fixture();
  const corpus = [`<script>alert('x')</script>`, '" onmouseover="alert(1)', '</textarea><img src=x onerror=alert(1)>', '&lt;script&gt;', 'λ🙂\u202e'];
  f.items(corpus.map((value, index) => row({ id: `c${index}`, authorName: value, bodyText: value, depth: 500 })).concat([
    row({ id: 'held', status: 'pending', bodyText: 'HIDDEN_PENDING' }), row({ entryId: 'other', bodyText: 'HIDDEN_ENTRY' }), row({ workspaceId: 'other', bodyText: 'HIDDEN_SITE' }),
  ]));
  f.cursor('opaque+/=');
  const { html } = await f.provider.renderer.renderThread({ siteId: 's', entry, locale: 'en' }, { cursor: 'before' });
  assert.deepEqual(f.calls.query, { workspaceId: 's', entryId: 'e', status: 'approved', limit: 200, cursor: 'before' });
  for (const secret of ['private@example.test', 'PRIVATE_IP_HASH', 'javascript:secret', 'HIDDEN_PENDING', 'HIDDEN_ENTRY', 'HIDDEN_SITE', '<script>', '<img', ' onmouseover="']) assert.ok(!html.includes(secret), secret);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-comment-depth="5"/);
  assert.match(html, /commentCursor=opaque%2B%2F%3D#comments/);
  assert.match(html, /method="post" action="\/api\/site\/comments"/);
  assert.match(html, /name="website"/);
  assert.match(html, /#comment-pending:not\(:target\),#comment-error:not\(:target\)\{display:none\}/, 'notices show only after the 303');
  assert.match(html, /name="returnTo" value="\/post"/);
  assert.equal(f.calls.reads, 1);
  assert.equal(BUILTIN_COMMENTS_DEFINITION.implementation, 'adapter');
});

test('rendering reads fresh settings and rows; disable and foreign sites cannot disclose data', async () => {
  const f = fixture();
  f.items([row({ depth: -10 })]);
  let rendered = await f.provider.renderer.renderThread({ siteId: 's', entry: { ...entry, canonicalUrl: 'https://site.test//evil.test' }, locale: 'en' });
  assert.match(rendered.html, /data-comment-depth="0"/);
  assert.match(rendered.html, /name="returnTo" value="\/"/);
  assert.ok(!rendered.html.includes('rel="next"'));
  f.items([row({ bodyText: 'Changed after approval' })]);
  rendered = await f.provider.renderer.renderThread({ siteId: 's', entry, locale: 'en' }, {});
  assert.match(rendered.html, /Changed after approval/);
  f.settings.enabled = false;
  assert.deepEqual(await f.provider.renderer.renderThread({ siteId: 's', entry, locale: 'en' }), { html: '' });
  assert.equal(f.calls.reads, 2);
  await assert.rejects(f.provider.renderer.renderThread({ siteId: 'foreign', entry, locale: 'en' }), /site mismatch/);
});

test('submission preserves CMS ingress, hash and honeypot; moderation keeps engine OCC and actor attribution', async () => {
  const f = fixture();
  const submission = { siteId: 's', entryId: 'e', parentId: null, authorName: 'Name', authorEmail: null, authorUrl: null, bodyRaw: 'Body', authorIpHash: 'hash', honeypotValue: '' };
  assert.deepEqual(await f.provider.submission.submit(submission), { ok: true, id: 'c', status: 'pending' });
  assert.deepEqual(f.calls.submit, { workspaceId: 's', entryId: 'e', parentId: null, authorName: 'Name', authorEmail: null, authorUrl: null, bodyRaw: 'Body', authorPrincipalId: null, ingressContext: { authorIpHash: 'hash', honeypotValue: '' } });
  f.reject();
  assert.deepEqual(await f.provider.submission.submit(submission), { ok: false, reason: 'honeypot-tripped' });
  await assert.rejects(f.provider.submission.submit({ ...submission, siteId: 'foreign' }), /site mismatch/);
  assert.equal((await f.provider.moderation.listQueue({ siteId: 's', status: 'pending', limit: 20 })).items.length, 1);
  assert.equal((await f.provider.moderation.get({ siteId: 's', id: 'c' }))?.id, 'c');
  assert.equal(await f.provider.moderation.get({ siteId: 's', id: 'missing' }), null);
  for (const [action, toStatus] of [['approve', 'approved'], ['mark_spam', 'spam'], ['trash', 'trash'], ['restore', 'approved']] as const) {
    const input = { siteId: 's', id: 'c', expectedVersion: 1, actorPrincipalId: 'owner', actorPluginId: 'assistant', note: null, action };
    assert.deepEqual(await f.provider.moderation.apply(input), { ok: true });
    assert.deepEqual(f.calls.apply, { workspaceId: 's', id: 'c', expectedVersion: 1, actorPrincipalId: 'owner', actorPluginId: 'assistant', note: null, action, toStatus });
  }
  assert.deepEqual(await f.provider.moderation.purge({ siteId: 's', id: 'c', actorPrincipalId: 'owner', note: null }), { ok: true });
  assert.deepEqual(f.calls.purge, { workspaceId: 's', id: 'c', actorPrincipalId: 'owner', note: null });
  f.settings.enabled = false;
  await assert.rejects(f.provider.moderation.apply({ siteId: 's', id: 'c', expectedVersion: 1, actorPrincipalId: 'owner', note: null, action: 'approve' }), /disabled/);
  assert.deepEqual(await f.provider.moderation.purge({ siteId: 's', id: 'c', actorPrincipalId: 'owner', note: null }), { ok: true }, 'erasure still works while disabled');
  await assert.rejects(f.provider.moderation.purge({ siteId: 'foreign', id: 'c', actorPrincipalId: 'owner', note: null }), /site mismatch/);
  assert.equal((await f.provider.moderation.listQueue({ siteId: 's', status: 'pending', limit: 20 })).items.length, 1, 'disabled queue remains readable');
  createBuiltinCommentsProvider(f.deps, {});
});

test('replies follow their parent; orphans and malformed cycles still render once, after the threads', async () => {
  const f = fixture();
  f.items([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'a1', parentId: 'a', depth: 1 }), row({ id: 'a1x', parentId: 'a1', depth: 2 }),
    row({ id: 'orphan', parentId: 'earlier-page', depth: 1 }), row({ id: 'x', parentId: 'y', depth: 1 }), row({ id: 'y', parentId: 'x', depth: 1 })]);
  const { html } = await f.provider.renderer.renderThread({ siteId: 's', entry, locale: 'en' });
  assert.deepEqual([...html.matchAll(/<li id="comment-([^"]+)"/g)].map(match => match[1]), ['a', 'a1', 'a1x', 'b', 'orphan', 'x', 'y']);
});

test('a stale or hand-edited cursor falls back to the first page; other repo failures still surface', async () => {
  const f = fixture();
  const queries: unknown[] = [];
  const base = f.deps.repo.listModerationQueue;
  f.deps.repo.listModerationQueue = async input => {
    queries.push(input.cursor);
    if (input.cursor === 'gone') throw new ToolInputError({ message: 'invalid cursor' });
    if (input.cursor === 'boom') throw new Error('database down');
    return base(input);
  };
  const { html } = await f.provider.renderer.renderThread({ siteId: 's', entry, locale: 'en' }, { cursor: 'gone' });
  assert.deepEqual(queries, ['gone', undefined]);
  assert.match(html, /<a href="\/post#comments">First comments<\/a>/);
  assert.ok(!(await f.provider.renderer.renderThread({ siteId: 's', entry, locale: 'en' })).html.includes('First comments'));
  await assert.rejects(f.provider.renderer.renderThread({ siteId: 's', entry, locale: 'en' }, { cursor: 'boom' }), /database down/);
});
