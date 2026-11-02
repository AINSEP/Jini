import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../api.mjs';
import { formPageRoutes, normalizeForms, provisionForms, pullFormSubmissions } from '../forms.mjs';
import { fakeD1 } from './d1-fake.mjs';
import { credential, fixture, json, routes } from './fixture.mjs';

// Edge inputs of lib/forms.mjs the main forms.test.mjs does not reach: absent fields, query answers
// without rows, a kit without a clock, unparseable paging numbers, and the row-metadata rules.

const SECRET = 'k'.repeat(43);
const destination = { url: 'https://jini-demo.acct.workers.dev/', secret: SECRET };

test('a field that is missing or has no name is refused with the rename step', () => {
  const kit = fixture({ respond: () => { throw new Error('no network'); } }).kit;
  for (const field of [null, {}]) {
    assert.throws(() => normalizeForms({ formDestination: { forms: [{ slug: 'a', fields: [field] }], secret: SECRET }, kit }),
      error => error.code === 'CLOUDFLARE_FORMS_INVALID' && error.message === 'CLOUDFLARE_FORMS_INVALID: Form a has a field name that cannot be served here. Rename the field in the site admin, then publish again.');
  }
});

test('migrations run with the system clock when the kit has none, and tolerate query answers without rows', async () => {
  const d1 = fakeD1({ migrated: false });
  const f = fixture({ respond: routes([
    // The first statement's answer carries an item with no `results` and a null item: both read as no rows.
    [/\/d1\/database\/[^/]+\/query$/, 'POST', ({ init }) => { const out = d1.rest(JSON.parse(init.body)); return json(/schema_migrations \(version INTEGER/.test(init.body) ? [{ success: true }, null] : out); }],
    ['/d1/database', 'GET', () => json([{ name: 'tovu-forms-jini-demo', uuid: 'db-1' }])],
  ]) });
  const kit = { ...f.kit };
  delete kit.now;
  const before = Date.now();
  const result = await provisionForms({ api: createApi({ credential, kit }), kit, resourceName: 'jini-demo' });
  assert.deepEqual(result, { databaseId: 'db-1', databaseName: 'tovu-forms-jini-demo', applied: [1] });
  const [row] = d1.rows('SELECT version, applied_at FROM schema_migrations');
  assert.equal(row.version, 1);
  assert.ok(Date.parse(row.applied_at) >= before - 1000 && Date.parse(row.applied_at) <= Date.now() + 1000, row.applied_at);
});

test('form page routes skip an entry with no file name', () => {
  const form = Buffer.from('<form data-form-slug="w"></form>');
  assert.deepEqual(formPageRoutes({ files: [{ data: form }, { file: 'join.html', data: form }] }), ['/join.html', '/join']);
});

test('paging numbers that do not parse fall back: after 0, limit 50; a tiny limit is raised to 1', async () => {
  const seen = [];
  const f = fixture({ respond: ({ url }) => { seen.push(url.search); return Response.json({ items: [], nextAfter: 'n/a' }); } });
  assert.deepEqual(await pullFormSubmissions({ kit: f.kit, destination }, { after: 'abc', limit: 0 }), { items: [], nextAfter: 0, hasMore: false });
  await pullFormSubmissions({ kit: f.kit, destination }, { after: 2, limit: -5 });
  assert.deepEqual(seen, ['?after=0&limit=50', '?after=2&limit=1']);
});

test('a pending row needs a string submittedAt and an ip that is null or a string', async () => {
  const base = { seq: 1, id: 'r-1', formSlug: 'f', answers: { a: 'b' }, submittedAt: '2026-10-19T10:00:00.000Z' };
  const ok = fixture({ respond: () => Response.json({ items: [{ ...base, ip: '203.0.113.9' }] }) });
  assert.equal((await pullFormSubmissions({ kit: ok.kit, destination })).items[0].ip, '203.0.113.9');
  for (const bad of [{ ...base, ip: 5 }, { ...base, ip: null, submittedAt: 1 }, { ...base, ip: undefined }]) {
    const f = fixture({ respond: () => Response.json({ items: [bad] }) });
    await assert.rejects(pullFormSubmissions({ kit: f.kit, destination }), error => error.code === 'CLOUDFLARE_FORMS_INVALID_RESPONSE');
  }
});
