import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { createRouting, type RoutingContentRecord } from '../index.js';

const ctx = { workspaceId: 'workspace-a', siteId: 'site-a', locale: 'fr', originOverride: 'https://a.example/' };
const post: RoutingContentRecord = { slug: 'hello', status: 'published' };

test('host visibility changes actual URLs for both record and id resolution', async () => {
  const seen: RoutingContentRecord[] = [];
  const make = (live: boolean) => createRouting({ ports: {
    isLive: ({ post }) => { seen.push(post); return live; },
    reportPhaseError: () => {},
  } });
  const visible = make(true);
  const hidden = make(false);
  const reads: unknown[] = [];
  const input = { deps: { postRepo: { findById: async (input: { workspaceId: string; id: string }) => {
    reads.push(input); return post;
  } } }, target: { kind: 'entryRef' as const, entryId: 'entry-1' }, ctx };
  const expected = { path: '/hello', canonicalUrl: 'https://a.example/hello' };
  assert.deepEqual(visible.entryPublicPath({ post, ctx }), expected);
  assert.equal(hidden.entryPublicPath({ post, ctx }), null);
  assert.deepEqual(await visible.urlFor(input), expected);
  assert.equal(await hidden.urlFor(input), null);
  assert.deepEqual(reads, [{ workspaceId: 'workspace-a', id: 'entry-1' }, { workspaceId: 'workspace-a', id: 'entry-1' }]);
  assert.deepEqual(seen, [post, post, post, post]);
});

test('named routes, phase owners and slug captures are isolated between routing instances', async () => {
  const ports = { isLive: () => true, reportPhaseError: () => {} };
  const a = createRouting({ ports }, { namedRoutes: [['home', '/a']] });
  const b = createRouting({ ports });
  a.registerNamedRoute({ name: 'search', path: '/a/search' });
  assert.equal(a.getNamedRoute({ name: 'home' }), '/a');
  assert.equal(b.getNamedRoute({ name: 'home' }), '/');
  assert.equal(b.getNamedRoute({ name: 'search' }), '/search');
  const owner = Symbol('same-owner');
  a.registerResolvePhase({ phase: 'pre_content', resolver: async () => ({ kind: 'redirect', location: '/a', statusCode: 301 }) }, { owner });
  b.registerResolvePhase({ phase: 'pre_content', resolver: async () => ({ kind: 'redirect', location: '/b', statusCode: 302 }) }, { owner });
  a.unregisterResolvePhaseOwner({ owner });
  assert.equal(await a.runPreContentPhase({ path: '/old', ctx }), null);
  assert.deepEqual(await b.runPreContentPhase({ path: '/old', ctx }), { kind: 'redirect', location: '/b', statusCode: 302 });
  const capture = { onSlugChange: async () => {} };
  a.registerSlugChangeCapture({ impl: capture });
  assert.equal(a.getSlugChangeCapture({}), capture);
  assert.equal(b.getSlugChangeCapture({}), undefined);
});

test('skip reports the exact fault through its injected channel; fail propagates without a report', async () => {
  const reports: unknown[] = [];
  const routing = createRouting({ ports: { isLive: () => true, reportPhaseError: input => { reports.push(input); } } });
  const error = new Error('guard store down');
  routing.registerResolvePhase({ phase: 'pre_content', resolver: async () => { throw error; } }, { onError: 'skip' });
  routing.registerResolvePhase({ phase: 'pre_content', resolver: async () => ({ kind: 'resolved', path: '/next' }) });
  assert.deepEqual(await routing.runPreContentPhase({ path: '/old/?q=1', ctx }), { kind: 'resolved', path: '/next' });
  assert.deepEqual(reports, [{ message: '[routing] a pre_content resolver failed for /old — skipping it', error }]);
  routing.registerResolvePhase({ phase: 'post_content', resolver: async () => { throw error; } });
  await assert.rejects(routing.runPostContentPhase({ path: '/old', ctx }), actual => actual === error);
  assert.equal(reports.length, 1);
});

test('a running phase snapshots registrations when a handler revokes its sibling', async () => {
  const routing = createRouting({ ports: { isLive: () => true, reportPhaseError: () => {} } });
  const seen: string[] = [];
  let disposeSibling = () => {};
  routing.registerResolvePhase({ phase: 'pre_content', resolver: async () => { seen.push('first'); disposeSibling(); return null; } });
  disposeSibling = routing.registerResolvePhase({ phase: 'pre_content', resolver: async () => { seen.push('sibling'); return null; } });
  await routing.runPreContentPhase({ path: '/', ctx });
  await routing.runPreContentPhase({ path: '/', ctx });
  assert.deepEqual(seen, ['first', 'sibling', 'first']);
});


test('routing retains the original barrel boundary, open items and ADR-039 registry rationale verbatim', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const rationale of [
    `- Public surface is the \`index.ts\` barrel only; deep imports into this
  library's internals are not supported.`,
    `- \`isActive\` ancestor/prefix semantics (nested menu highlighting) and the
  \`urlFor → null\` caller-render contract are v0.1 work (ADR-039 "Open").`,
    `- Per ADR-039 §4's promotion trigger, the day a second in-tx participant
  alongside \`SlugChangeCapture\` is real (ADR-039's Round-3 fold already names
  Menus' binding-index write as that second participant), the single-slot
  model should be generalized into a small ordered core-only registry — a
  mechanical refactor, not a contract change.`,
  ]) assert.ok(readme.includes(rationale), rationale);
});
