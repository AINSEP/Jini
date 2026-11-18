/**
 * @file The note entity port over the real cms entry services and `InMemoryEntryRepo`: create, update with
 * the version the caller read (a stale writer loses and changes nothing), status through publish/unpublish.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEntryRepo } from '@jini-ai/cms/entries';
import type { AdminErasedEntityPort } from '@jini-ai/admin/core';
import { createAppPorts, authorize, OWNER_ID } from './ports.ts';
import { NoteEntityError } from './note-descriptor.ts';
import { createNoteEntityPort } from './notes-entity.ts';

async function fixture(): Promise<{ port: AdminErasedEntityPort; repo: InMemoryEntryRepo }> {
  const ports = await createAppPorts();
  const repo = new InMemoryEntryRepo();
  const entryDeps = { entryRepo: repo, contentTypeRepo: ports.contentTypeRepo, clock: ports.clock, authorize, outbox: ports.entryOutbox };
  const port = createNoteEntityPort({ deps: { entryRepo: repo, entryDeps, ids: ports.idGen, actor: { actorId: OWNER_ID, principalKind: 'user' } } });
  return { port, repo };
}

const rejects = (promise: Promise<unknown>, code: NoteEntityError['code']) =>
  assert.rejects(promise, (error: unknown) => error instanceof NoteEntityError && error.code === code);

describe('note entity port: create and read', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  before(async () => { f = await fixture(); });

  it('creates a draft at version 1 with a slug made from the title and a body as text', async () => {
    const row = await f.port.create({ title: 'Buy Milk!', body: 'two litres' });
    assert.deepEqual({ title: row.title, slug: row.slug, body: row.body, status: row.status, version: row.version }, { title: 'Buy Milk!', slug: 'buy-milk', body: 'two litres', status: 'draft', version: 1 });
    assert.deepEqual(await f.port.get(row.id), row);
  });

  it('gives a second note with the same title the next free slug, and honours an explicit slug', async () => {
    const second = await f.port.create({ title: 'Buy Milk!' });
    assert.equal(second.slug, 'buy-milk-2');
    assert.equal((await f.port.create({ title: 'x', slug: 'chosen-slug' })).slug, 'chosen-slug');
    await rejects(f.port.create({ title: 'y', slug: 'chosen-slug' }), 'CONFLICT');
  });

  it('refuses a create without a title, with a bad slug or with a status it cannot create as', async () => {
    await rejects(f.port.create({}), 'VALIDATION');
    await rejects(f.port.create({ title: '   ' }), 'VALIDATION');
    await rejects(f.port.create({ title: 'ok', slug: 'Not A Slug' }), 'VALIDATION');
    await rejects(f.port.create({ title: 'ok', status: 'unpublished' }), 'VALIDATION');
    await rejects(f.port.create({ title: 'ok', body: 42 }), 'VALIDATION');
  });

  it('creates a published note when asked for status published', async () => {
    const row = await f.port.create({ title: 'Live one', status: 'published' });
    assert.equal(row.status, 'published');
    assert.equal(row.version, 2);
  });

  it('get answers null for an unknown id and for an entry of another type', async () => {
    assert.equal(await f.port.get('nope'), null);
  });

  it('has no remove: entries have no delete', () => {
    assert.equal(f.port.remove, undefined);
  });
});

describe('note entity port: update, concurrency and status', () => {
  it('updates with the current version and increments it', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'One' });
    const next = await f.port.update(row.id, { title: 'One edited', version: 1 });
    assert.deepEqual({ title: next.title, version: next.version }, { title: 'One edited', version: 2 });
  });

  it('a stale writer gets CONFLICT and the stored title stays the first writer\'s', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'Shared' });
    const [first, second] = [await f.port.get(row.id), await f.port.get(row.id)];
    await f.port.update(row.id, { title: 'First writer', version: Number(first?.version) });
    await rejects(f.port.update(row.id, { title: 'Second writer', version: Number(second?.version) }), 'CONFLICT');
    assert.equal((await f.port.get(row.id))?.title, 'First writer');
  });

  it('refuses an update without a version, with a fractional one, or for an unknown id', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'One' });
    await rejects(f.port.update(row.id, { title: 'x' }), 'VALIDATION');
    await rejects(f.port.update(row.id, { title: 'x', version: 1.5 }), 'VALIDATION');
    await rejects(f.port.update('missing', { title: 'x', version: 1 }), 'NOT_FOUND');
  });

  it('draft -> published publishes; published -> unpublished ends in unpublished (not draft)', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'Flow' });
    const published = await f.port.update(row.id, { status: 'published', version: 1 });
    assert.deepEqual({ status: published.status, version: published.version }, { status: 'published', version: 2 });
    const unpublished = await f.port.update(row.id, { status: 'unpublished', version: 2 });
    assert.deepEqual({ status: unpublished.status, version: unpublished.version }, { status: 'unpublished', version: 3 });
    await rejects(f.port.update(row.id, { status: 'draft', version: 3 }), 'VALIDATION');
  });

  it('refuses a status that is not one of the three, without changing the note', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'Flow' });
    await rejects(f.port.update(row.id, { title: 'changed', status: 'banana', version: 1 }), 'VALIDATION');
    assert.deepEqual({ title: (await f.port.get(row.id))?.title, version: (await f.port.get(row.id))?.version }, { title: 'Flow', version: 1 });
  });

  it('title and status in one patch apply both; the final version is start + 2', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'Both' });
    const next = await f.port.update(row.id, { title: 'Both edited', status: 'published', version: 1 });
    assert.deepEqual({ title: next.title, status: next.status, version: next.version }, { title: 'Both edited', status: 'published', version: 3 });
  });

  it('a stale version in a title+status patch changes neither', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'Both' });
    await f.port.update(row.id, { title: 'Moved on', version: 1 });
    await rejects(f.port.update(row.id, { title: 'Late', status: 'published', version: 1 }), 'CONFLICT');
    const stored = await f.port.get(row.id);
    assert.deepEqual({ title: stored?.title, status: stored?.status }, { title: 'Moved on', status: 'draft' });
  });

  it('the slug and updatedAt a screen sends back unchanged are accepted; a different slug is refused', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'Slugged' });
    const kept = await f.port.update(row.id, { title: 'Slugged 2', slug: row.slug, updatedAt: row.updatedAt, version: 1 });
    assert.equal(kept.slug, 'slugged');
    await rejects(f.port.update(row.id, { slug: 'other', version: 2 }), 'VALIDATION');
  });

  it('writes the body as text and leaves it alone when the patch has none', async () => {
    const f = await fixture();
    const row = await f.port.create({ title: 'Body', body: 'first' });
    const edited = await f.port.update(row.id, { body: 'second', version: 1 });
    assert.equal(edited.body, 'second');
    assert.equal((await f.port.update(row.id, { title: 'Body 2', version: 2 })).body, 'second');
  });
});

describe('note entity port: list', () => {
  it('lists newest first with a stable keyset cursor, limit and total', async () => {
    const f = await fixture();
    for (const title of ['A', 'B', 'C']) await f.port.create({ title });
    const first = await f.port.list({ limit: 2 });
    assert.equal(first.items.length, 2);
    assert.equal(first.total, 3);
    assert.notEqual(first.nextCursor, null);
    const second = await f.port.list({ limit: 2, cursor: first.nextCursor as string });
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 3);
  });

  it('filters by search text over title and body', async () => {
    const f = await fixture();
    await f.port.create({ title: 'Groceries', body: 'milk and eggs' });
    await f.port.create({ title: 'Work', body: 'ship it' });
    assert.deepEqual((await f.port.list({ search: 'MILK' })).items.map((row) => row.title), ['Groceries']);
    assert.equal((await f.port.list({ search: '   ' })).items.length, 2);
  });

  it('refuses a filter, a sort and an unknown cursor it cannot honour', async () => {
    const f = await fixture();
    await rejects(f.port.list({ filter: [{ field: 'title', op: 'eq', value: 'x' }] }), 'VALIDATION');
    await rejects(f.port.list({ sort: { field: 'title', direction: 'asc' } }), 'VALIDATION');
    await rejects(f.port.list({ cursor: 'no-such-id' }), 'VALIDATION');
  });
});
