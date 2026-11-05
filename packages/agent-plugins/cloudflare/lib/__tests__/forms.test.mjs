import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../api.mjs';
import { acknowledgeFormSubmissions, databaseName, formPageRoutes, formsWorkerParts, normalizeForms, previewForms, provisionForms, pullFormSubmissions, receiverModule } from '../forms.mjs';
import { fakeD1 } from './d1-fake.mjs';
import { credential, fixture, json, routes } from './fixture.mjs';

const SECRET = 'k'.repeat(43);
const forms = [{ slug: 'byho-waitlist', fields: [{ name: 'email', required: true, maxLength: 254 }, { name: 'interests', required: true, multiple: true }, { name: 'note', maxLength: null }] }];
const destination = { url: 'https://jini-demo.acct.workers.dev/some/path', secret: SECRET };

test('normalizeForms keeps the compact manifest and refuses unusable input with the next step', () => {
  const kit = fixture({ respond: () => { throw new Error('no network'); } }).kit;
  assert.equal(normalizeForms({ formDestination: undefined, kit }), null);
  assert.equal(normalizeForms({ formDestination: { forms: [] }, kit }), null);
  assert.deepEqual(normalizeForms({ formDestination: { forms: [{ ...forms[0], successPath: '/thanks/' }], secret: SECRET }, kit }), {
    secret: SECRET, forms: [{ slug: 'byho-waitlist', successPath: '/thanks/', fields: [{ name: 'email', required: true, maxLength: 254 }, { name: 'interests', required: true, multiple: true }, { name: 'note', required: false }] }] });
  assert.ok(normalizeForms({ formDestination: { forms }, kit }, { requireSecret: false }));
  const refusals = [
    [{ forms: 'x' }, /at most 50 forms/],
    [{ forms: Array.from({ length: 51 }, () => forms[0]), secret: SECRET }, /at most 50 forms/],
    [{ forms }, /receiver key is missing/],
    [{ forms, secret: 'short' }, /receiver key is missing/],
    [{ forms: [{ slug: 'Bad Slug', fields: forms[0].fields }], secret: SECRET }, /Bad Slug.*lowercase/],
    [{ forms: [{ slug: 'a', fields: [] }], secret: SECRET }, /needs 1-100 fields/],
    [{ forms: [{ slug: 'a', fields: forms[0].fields, successPath: '//evil.example' }], secret: SECRET }, /success page/],
    [{ forms: [{ slug: 'a', fields: forms[0].fields, successPath: 7 }], secret: SECRET }, /success page/],
    [{ forms: [{ slug: 'a', fields: [{ name: 'has space' }] }], secret: SECRET }, /field name/],
    [{ forms: [{ slug: 'a', fields: [{ name: 'x', maxLength: 0 }] }], secret: SECRET }, /maximum length/],
    [{ forms: [{}], secret: SECRET }, /undefined/],
  ];
  for (const [formDestination, message] of refusals) assert.throws(() => normalizeForms({ formDestination, kit }), error => error.code === 'CLOUDFLARE_FORMS_INVALID' && message.test(error.message));
});

test('database name is stable and capped from the Worker identity', () => {
  assert.equal(databaseName({ resourceName: 'jini-demo' }), 'tovu-forms-jini-demo');
  assert.equal(databaseName({ resourceName: 'x'.repeat(63) }).length, 63);
});

test('preview: create vs reuse, Pages unsupported, missing D1 permission named, other failures propagate', async () => {
  const run = async ({ list, targetId = 'cloudflare-workers', formDestination = { forms } }) => {
    const f = fixture({ respond: routes([['/d1/database', 'GET', list]]) });
    const api = createApi({ credential, kit: f.kit });
    return previewForms({ api, kit: f.kit, resourceName: 'jini-demo', targetId, formDestination });
  };
  assert.equal(await run({ list: () => json([]), formDestination: { forms: [] } }), undefined);
  const created = await run({ list: ({ url }) => { assert.equal(url.searchParams.get('name'), 'tovu-forms-jini-demo'); return json([{ name: 'tovu-forms-jini-demo-old', uuid: 'x' }]); } });
  assert.equal(created.status, 'on');
  assert.equal(created.changes[0].action, 'create');
  assert.match(created.message, /^Form submissions: on \(1 form\)\. .*tovu-forms-jini-demo \(created\).*pulled into the site admin on demand\. Free plan limits: 100,000 Worker requests\/day, D1 100,000 row writes\/day and 500 MB/);
  const reused = await run({ list: () => json([{ name: 'tovu-forms-jini-demo', uuid: 'db-1' }]), formDestination: { forms: [forms[0], { ...forms[0], slug: 'other' }] } });
  assert.deepEqual(reused.changes[0], { action: 'reuse', resource: 'd1-database', name: 'tovu-forms-jini-demo', databaseId: 'db-1' });
  assert.match(reused.message, /\(2 forms\).*\(reused\)/);
  const pages = await run({ list: () => { throw new Error('Pages must not read D1'); }, targetId: 'cloudflare-pages' });
  assert.equal(pages.status, 'unsupported');
  assert.match(pages.message, /Cloudflare Pages publishing cannot receive submissions yet/);
  const denied = await run({ list: () => json(null, 403, { errors: [{ code: 10000, message: 'Authentication error' }] }) });
  assert.equal(denied.status, 'permission-required');
  assert.match(denied.message, /^Form submissions need D1 access\. .*Account > D1 > Edit/);
  await assert.rejects(run({ list: () => json(null, 500) }), /CLOUDFLARE_API_ERROR/);
});

function provisionFixture({ d1, list = () => json([]), create }) {
  const created = [];
  const f = fixture({ respond: routes([
    [/\/d1\/database\/[^/]+\/query$/, 'POST', ({ init }) => json(d1.rest(JSON.parse(init.body)))],
    ['/d1/database', 'GET', list],
    ['/d1/database', 'POST', request => { created.push(JSON.parse(request.init.body).name); return create(request); }],
  ]) });
  return { f, created, api: createApi({ credential, kit: f.kit }) };
}

test('provision creates the database once, applies migrations once, and reruns as a no-op', async () => {
  const d1 = fakeD1({ migrated: false });
  let exists = false;
  const p = provisionFixture({ d1, list: () => json(exists ? [{ name: 'tovu-forms-jini-demo', uuid: 'db-1' }] : []), create: () => { exists = true; return json({ name: 'tovu-forms-jini-demo', uuid: 'db-1' }); } });
  const first = await provisionForms({ api: p.api, kit: p.f.kit, resourceName: 'jini-demo' });
  assert.deepEqual(first, { databaseId: 'db-1', databaseName: 'tovu-forms-jini-demo', applied: [1] });
  assert.deepEqual(d1.rows('SELECT version FROM schema_migrations'), [{ version: 1 }]);
  assert.deepEqual(d1.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('submissions', 'rate_windows') ORDER BY name").map(row => row.name), ['rate_windows', 'submissions']);
  const again = await provisionForms({ api: p.api, kit: p.f.kit, resourceName: 'jini-demo' });
  assert.deepEqual(again.applied, []);
  assert.deepEqual(p.created, ['tovu-forms-jini-demo']);
  assert.equal(p.f.calls.some(call => /DROP/i.test(String(call.init.body))), false, "provision preserves the schema while cleaning acknowledged payloads");
});

test('provision recovers a concurrent create race and refuses a database without an id', async () => {
  const d1 = fakeD1({ migrated: false });
  let lists = 0;
  const race = provisionFixture({ d1, list: () => json(lists++ ? [{ name: 'tovu-forms-jini-demo', uuid: 'db-2' }] : []), create: () => json(null, 400, { errors: [{ message: 'A database with that name already exists' }] }) });
  assert.equal((await provisionForms({ api: race.api, kit: race.f.kit, resourceName: 'jini-demo' })).databaseId, 'db-2');
  const failing = provisionFixture({ d1, create: () => json(null, 500) });
  await assert.rejects(provisionForms({ api: failing.api, kit: failing.f.kit, resourceName: 'jini-demo' }), /CLOUDFLARE_API_ERROR/);
  const blank = provisionFixture({ d1, create: () => json({ name: 'tovu-forms-jini-demo' }) });
  await assert.rejects(provisionForms({ api: blank.api, kit: blank.f.kit, resourceName: 'jini-demo' }), /CLOUDFLARE_D1_INVALID.*returned no id/);
  const odd = provisionFixture({ d1, list: () => json([{ name: 'tovu-forms-jini-demo', uuid: 'db-3' }]) });
  odd.f.kit.fetch = async (url, init) => (url.endsWith('/query') ? json({ unexpected: true }) : json([{ name: 'tovu-forms-jini-demo', uuid: 'db-3' }]));
  assert.deepEqual((await provisionForms({ api: createApi({ credential, kit: odd.f.kit }), kit: odd.f.kit, resourceName: 'jini-demo' })).applied, [1]);
});

test('worker parts compile the manifest in and bind D1 plus the receiver key', async () => {
  const parts = await formsWorkerParts({ manifest: { forms, secret: SECRET }, secret: SECRET, databaseId: 'db-1' });
  assert.deepEqual(parts.modules.map(module => module.name), ['index.mjs', 'receiver.mjs', 'portable-validation.mjs', 'forms-manifest.mjs']);
  assert.equal(parts.modules[1].source, await receiverModule());
  assert.match(parts.modules[1].source, /export async function handleRequest/);
  assert.equal(parts.modules[3].source.includes(SECRET), false, 'the key never enters module source');
  assert.deepEqual(parts.bindings, [{ type: 'd1', name: 'TOVU_FORMS', id: 'db-1' }, { type: 'secret_text', name: 'TOVU_FORMS_SECRET', text: SECRET }]);
  assert.deepEqual(parts.runWorkerFirst, ['/forms/*', '/_tovu/*']);
  const withPages = await formsWorkerParts({ manifest: { forms, secret: SECRET }, secret: SECRET, databaseId: 'db-1' }, { pageRoutes: ['/', '/join/', '/join'] });
  assert.deepEqual(withPages.runWorkerFirst, ['/forms/*', '/_tovu/*', '/', '/join/', '/join']);
});

test('form page routes list exact paths of exported HTML pages that render a host form', () => {
  const page = (file, body) => ({ file, data: Buffer.from(body) });
  const form = '<main><form class="tovu-form" data-form-slug="waitlist" method="post"></form></main>';
  const files = [
    page('index.html', form), page('join\\index.html', form), page('./artists.html', form),
    page('about/index.html', '<p>no form here</p>'), page('style.css', form), page('blog/form.html', '<form method="get"></form>'),
    { file: 'empty.html' },
  ];
  assert.deepEqual(formPageRoutes({ files }), ['/', '/join/', '/join', '/artists.html', '/artists']);
  assert.deepEqual(formPageRoutes({ files }, { max: 3 }), ['/', '/join/', '/join'], 'stops before a page that would pass the cap');
  assert.deepEqual(formPageRoutes({}), []);
});

test('pull reads one page with the bearer key from the site origin and validates its shape', async () => {
  const item = { seq: 4, id: 'r-4', formSlug: 'byho-waitlist', answers: { email: 'a@b.co' }, submittedAt: '2026-10-19T10:00:00.000Z', ip: null };
  const f = fixture({ respond: ({ url, init }) => {
    assert.equal(url.origin, 'https://jini-demo.acct.workers.dev');
    assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
    assert.equal(init.redirect, 'error');
    if (url.pathname === '/_tovu/forms/ack') { assert.deepEqual(JSON.parse(init.body), { ids: ['r-4'] }); return Response.json({ acknowledged: 1 }); }
    assert.equal(url.search, '?after=3&limit=100');
    return Response.json({ items: [item], nextAfter: 4, hasMore: true });
  } });
  assert.deepEqual(await pullFormSubmissions({ kit: f.kit, destination }, { after: 3, limit: 500 }), { items: [item], nextAfter: 4, hasMore: true });
  assert.deepEqual(await acknowledgeFormSubmissions({ kit: f.kit, destination, ids: ['r-4'] }), { acknowledged: 1 });
  const defaults = fixture({ respond: ({ url }) => { assert.equal(url.search, '?after=0&limit=50'); return Response.json({ items: [] }); } });
  assert.deepEqual(await pullFormSubmissions({ kit: defaults.kit, destination }), { items: [], nextAfter: 0, hasMore: false });
  const odd = fixture({ respond: () => Response.json({}) });
  assert.deepEqual(await acknowledgeFormSubmissions({ kit: odd.kit, destination, ids: ['x'] }), { acknowledged: 0 });
});

test('pull failures name the cause and the next step without echoing the key', async () => {
  const cases = [
    [() => new Response('', { status: 401 }), /CLOUDFLARE_FORMS_UNAUTHORIZED.*Republish/],
    [() => new Response('', { status: 404 }), /CLOUDFLARE_FORMS_RECEIVER_MISSING/],
    [() => new Response('', { status: 503 }), /CLOUDFLARE_FORMS_UNAVAILABLE.*HTTP 503/],
    [() => { throw new TypeError('network'); }, /CLOUDFLARE_FORMS_UNREACHABLE/],
    [() => new Response('not json'), /CLOUDFLARE_FORMS_INVALID_RESPONSE/],
    [() => Response.json({ items: [{ seq: 'x' }] }), /CLOUDFLARE_FORMS_INVALID_RESPONSE.*unexpected page/],
    [() => Response.json({ items: Array.from({ length: 101 }, () => ({})) }), /unexpected page/],
  ];
  for (const [respond, message] of cases) {
    const f = fixture({ respond });
    await assert.rejects(pullFormSubmissions({ kit: f.kit, destination }), error => message.test(error.message) && !error.message.includes(SECRET));
  }
  const f = fixture({ respond: () => { throw new Error('must not call'); } });
  await assert.rejects(pullFormSubmissions({ kit: f.kit, destination: { url: 'http://insecure.example', secret: SECRET } }), /CLOUDFLARE_FORMS_ADDRESS/);
  await assert.rejects(pullFormSubmissions({ kit: f.kit, destination: { url: 'not a url', secret: SECRET } }), /CLOUDFLARE_FORMS_ADDRESS/);
  await assert.rejects(pullFormSubmissions({ kit: f.kit, destination: { url: destination.url, secret: 'short' } }), /CLOUDFLARE_FORMS_KEY_REQUIRED/);
});

test('republish removes old acknowledged PII and raw IPs from earlier receivers before upload', async () => {
  const d1 = fakeD1();
  await d1.binding.prepare('INSERT INTO submissions (id,form_slug,answers_json,submitted_at,ip,pulled_at) VALUES (?,?,?,?,?,?)').bind('acked','contact','{"private":"answer"}','2026-01-01','203.0.113.9','2026-01-02').run();
  await d1.binding.prepare('INSERT INTO submissions (id,form_slug,answers_json,submitted_at,ip) VALUES (?,?,?,?,?)').bind('pending','contact','{}','2026-11-04','203.0.113.9').run();
  await d1.binding.prepare('INSERT INTO rate_windows (key,window_start,count) VALUES (?,?,?)').bind('contact:203.0.113.9', 1, 1).run();
  const p = provisionFixture({ d1, list: () => json([{ name: 'tovu-forms-jini-demo', uuid: 'db-1' }]), create: () => assert.fail('already exists') });
  await provisionForms({ api: p.api, kit: p.f.kit, resourceName: 'jini-demo' });
  assert.deepEqual(d1.rows('SELECT id,ip FROM submissions'), [{ id: 'pending', ip: null }]);
  assert.deepEqual(d1.rows('SELECT * FROM rate_windows'), []);
});


test('preview shows uncollected counts and discloses indefinite retention without reading answers', async () => {
  const f = fixture({ respond: routes([
    ['/d1/database', 'GET', () => json([{ name: 'tovu-forms-jini-demo', uuid: 'db-1' }])],
    ['/d1/database/db-1/query', 'POST', ({init}) => {
      assert.equal(JSON.parse(init.body).sql, 'SELECT COUNT(*) AS count FROM submissions WHERE pulled_at IS NULL');
      return json([{ results: [{ count: 7 }] }]);
    }],
  ]) });
  const result = await previewForms({ api: createApi({ credential, kit: f.kit }), kit: f.kit, resourceName: 'jini-demo', targetId: 'cloudflare-workers', formDestination: { forms } });
  assert.equal(result.pendingCount, 7);
  assert.match(result.message, /Pending answers: 7/);
  assert.match(result.message, /never expire automatically/);
  assert.equal(f.calls.length, 2);
});


test('published portable validator module is self-contained and executes the same rules', async () => {
  const parts = await formsWorkerParts({ manifest: { forms }, secret: SECRET, databaseId: 'db-1' });
  const portable = parts.modules.find(module => module.name === 'portable-validation.mjs');
  assert.doesNotMatch(portable.source, /^import /m);
  const uri = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const bundled = parts.modules.find(module => module.name === 'receiver.mjs').source.replace('./portable-validation.mjs', uri(portable.source));
  const { checkFields } = await import(uri(bundled));
  const form = { fields: [{ name: 'count', type: 'number', min: 2, max: 8, step: 2 }] };
  assert.deepEqual(checkFields({ form, fields: new Map([['count', ['4']]]) }), { answers: { count: 4 } });
  assert.match(checkFields({ form, fields: new Map([['count', ['3']]]) }).error, /step mismatch/);
});
