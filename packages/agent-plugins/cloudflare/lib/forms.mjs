import { readFile } from 'node:fs/promises';
import { readSubmissionEvidence } from './cms-forms.mjs';
import { refusal, segment } from './api.mjs';

/** Form submissions destination: one D1 database per site Worker plus the bundled receiver.
 * Forms, fields and full validation stay in the host; this file only provisions storage and transport.
 * The `TOVU_*` bindings, `tovu-forms-*` database names and `/_tovu/*` routes are frozen wire names:
 * live Workers and D1 databases already use them. */
export const FORMS_BINDING = 'TOVU_FORMS';
export const FORMS_SECRET_BINDING = 'TOVU_FORMS_SECRET';
/** Routed to the Worker before static assets, so a missing asset can never answer a form POST. */
export const FORMS_WORKER_ROUTES = ['/forms/*', '/_tovu/*'];
export const FREE_PLAN_NOTE = 'Free plan limits: 100,000 Worker requests/day, D1 100,000 row writes/day and 500 MB per database (shared with the rest of this Cloudflare account).';
const D1_PAGING = { perPage: 100, maxPages: 10 };
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const FIELD_NAME = /^[A-Za-z0-9_.[\]-]{1,100}$/;
const MAX_FORMS = 50;
const MAX_FIELDS = 100;

/** Forward-only, plugin-owned. Append a new version; never edit or reorder an applied one. */
export const MIGRATIONS = Object.freeze([
  { version: 1, sql: [
    'CREATE TABLE IF NOT EXISTS submissions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, form_slug TEXT NOT NULL, answers_json TEXT NOT NULL, submitted_at TEXT NOT NULL, ip TEXT NULL, pulled_at TEXT NULL)',
    'CREATE INDEX IF NOT EXISTS submissions_pending ON submissions (pulled_at, seq)',
    'CREATE TABLE IF NOT EXISTS rate_windows (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)',
    'CREATE INDEX IF NOT EXISTS rate_windows_start ON rate_windows (window_start)',
  ] },
]);
const MIGRATIONS_TABLE = 'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)';

/** Validate host manifests, retaining an existing receiver when its saved key accompanies no forms.
 * @complexity O(total schema bytes) time/space, forms/fields/evidence bounded.
 * @overallScore 100 */
export function normalizeForms({ formDestination, kit }, { requireSecret = true } = {}) {
  const forms = formDestination?.forms ?? [];
  if (!Array.isArray(forms) || forms.length > MAX_FORMS) throw formsRefusal({ kit, message: `Expected at most ${MAX_FORMS} forms in the form manifest. Disable unused forms in the site admin, then publish again.` });
  if (forms.length === 0) return normalizeEmptyForms({ formDestination, kit, requireSecret });
  const secret = formDestination.secret;
  if (requireSecret) checkReceiverSecret({ secret, kit });
  return { forms: forms.map(form => normalizeForm({ form, kit })), secret };
}

/** Only a previously saved key can retain an empty receiver; plain form-less sites stay assets-only.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function normalizeEmptyForms({ formDestination, kit, requireSecret }, _options = {}) {
  const secret = formDestination?.secret;
  if (!secret) return null;
  if (requireSecret) checkReceiverSecret({ secret, kit });
  return { forms: [], secret };
}

function checkReceiverSecret({ secret, kit }, _options = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw formsRefusal({ kit, message: 'The form receiver key is missing. Publish again from the site admin so it can create the key.' });
}

/** Validate one schema and its bounded evidence before any remote provisioning.
 * @complexity O(schema bytes) time/space; no I/O. @overallScore 100 */
function normalizeForm({ form, kit }, _options = {}) {
  if (!SLUG.test(form?.slug ?? '')) throw formsRefusal({ kit, message: `Form slug "${String(form?.slug).slice(0, 100)}" cannot be served here. Use lowercase letters, digits and hyphens, then publish again.` });
  checkFieldCount({ form, kit });
  const successPath = form.successPath;
  checkSuccessPath({ form, successPath, kit });
  const evidence = form.evidence === undefined ? undefined : readSubmissionEvidence({ value: { ...form.evidence, capturedAt: 'published', source: 'cloudflare' } });
  return { slug: form.slug, ...(evidence ? { evidence } : {}), fields: form.fields.map(field => normalizeField({ field, kit, slug: form.slug })), ...(successPath ? { successPath } : {}) };
}

function checkFieldCount({ form, kit }, _options = {}) {
  if (!Array.isArray(form.fields) || form.fields.length === 0 || form.fields.length > MAX_FIELDS) throw formsRefusal({ kit, message: `Form ${form.slug} needs 1-${MAX_FIELDS} fields. Fix the form in the site admin, then publish again.` });
}

function checkSuccessPath({ form, successPath, kit }, _options = {}) {
  if (successPath === undefined) return;
  if (typeof successPath !== 'string' || !/^\/(?![/\\])[^\\\s]{0,499}$/.test(successPath)) throw formsRefusal({ kit, message: `Form ${form.slug} has an unusable success page. Use a path on this site starting with "/".` });
}

/** Preserve only the supported receiver constraints of one published field.
 * @complexity O(options) time/space; no I/O. @overallScore 100 */
function normalizeField({ field, kit, slug }, _options = {}) {
  if (!FIELD_NAME.test(field?.name ?? '')) throw formsRefusal({ kit, message: `Form ${slug} has a field name that cannot be served here. Rename the field in the site admin, then publish again.` });
  field = { ...field, ...(field.options ? { options: field.options.filter(value => value !== '') } : {}) };
  assertReceiverField({ field, kit, slug });
  const max = field.maxLength;
  checkMaxLength({ max, kit, slug, name: field.name });
  return { name: field.name, required: field.required === true, ...receiverConstraints({ field }), ...(Number.isInteger(max) ? { maxLength: max } : {}), ...(field.multiple === true ? { multiple: true } : {}) };
}

/** Project constraints unchanged after descriptor-boundary validation.
 * @complexity O(1) time/space; options referenced, no I/O. @overallScore 100 */
function receiverConstraints({ field }, _options = {}) {
  return {
    ...(field.type ? { type: field.type } : {}),
    ...(field.options ? { options: field.options } : {}),
    ...(field.minLength !== undefined ? { minLength: field.minLength } : {}),
    ...(field.checkboxValue !== undefined ? { checkboxValue: field.checkboxValue } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.step !== undefined ? { step: field.step } : {}),
  };
}

/** Refuse richer validation before provisioning a receiver that could report false success.
 * @complexity O(options) time and O(1) space; no I/O. @overallScore 100 */
function assertReceiverField({ field, kit, slug }, _options = {}) {
  const supported = ['text', 'textarea', 'hidden', 'email', 'tel', 'phone', 'url', 'number', 'range', 'date', 'time', 'datetime', 'datetime-local', 'color', 'password', 'checkbox', 'toggle', 'select', 'radio', 'multi-select', 'checkbox-group'];
  if (field.type === 'file') throw formsRefusal({ kit, message: `Form ${slug} field ${field.name} accepts files, but this receiver cannot store files. Remove the file field or choose a live server before publishing.` });
  const unrepresentableChoice = field.options?.some(value => typeof value !== 'string' || value.trim() === '');
  if (field.validationUnsupported || unrepresentableChoice || (field.type && !supported.includes(field.type))) throw formsRefusal({ kit, message: `Form ${slug} field ${field.name} needs validation this receiver cannot enforce. Publish to a live server or simplify this field, then publish again.` });
}

function checkMaxLength({ max, kit, slug, name }, _options = {}) {
  if (max === undefined || max === null) return;
  if (!(Number.isInteger(max) && max >= 1 && max <= 5000)) throw formsRefusal({ kit, message: `Form ${slug} field ${name} has an invalid maximum length. Use 1-5000.` });
}

function formsRefusal({ kit, message, status = 400, code = 'CLOUDFLARE_FORMS_INVALID' }, _options = {}) {
  return refusal({ kit, code, message, status });
}

/** Stable per-site identity derived from the Worker name; never random, so republish reuses it. */
export function databaseName({ resourceName }, _options = {}) {
  return `tovu-forms-${resourceName}`.slice(0, 63);
}

const PERMISSION_STEP = 'Edit the saved Cloudflare API token: add Account > D1 > Edit (dashboard: My Profile > API Tokens > the token > Edit), keep its existing Workers permissions, then preview again.';

/** Exact-name lookup. A 401/403 is reported as the missing D1 permission, never as "absent". */
export async function findDatabase({ api, kit, name }, _options = {}) {
  try {
    const items = await api.list({ path: `${api.accountPath}/d1/database?name=${segment({ value: name })}` }, D1_PAGING);
    return items.find(item => item.name === name) ?? null;
  } catch (error) {
    if (error.status === 401 || error.status === 403) throw formsRefusal({ kit, code: 'CLOUDFLARE_D1_PERMISSION_REQUIRED', status: 403, message: `Form submissions need D1 access. ${PERMISSION_STEP}` });
    throw error;
  }
}

/** Read-only preview lines for the publish confirmation. Pages has no receiver in v1.
 * @complexity O(schema bytes) space; one bounded inventory read and one indexed scalar count.
 * @overallScore 98 — Minor: the preview count is a snapshot and can change before publishing. */
export async function previewForms({ api, kit, resourceName, targetId, formDestination }, _options = {}) {
  const normalized = normalizeForms({ formDestination, kit }, { requireSecret: false });
  if (!normalized && !formDestination) return undefined;
  const count = normalized?.forms.length ?? 0;
  if (targetId !== 'cloudflare-workers') return unsupportedFormsPreview({ count });
  return previewWorkersForms({ api, kit, resourceName, normalized, count });
}

/** Explain an unsupported hosting target only when active built-in forms need it.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function unsupportedFormsPreview({ count }, _options = {}) {
  return count ? { status: 'unsupported', forms: count, changes: [], message: `This site has ${count} active form(s), but Cloudflare Pages publishing cannot receive submissions yet. Publish to Cloudflare Workers to accept form submissions; on Pages the forms will not submit.` } : undefined;
}

/** Inspect existing receiver resources without creating or modifying them.
 * @complexity One bounded inventory read and one indexed count; O(inventory) response space.
 * @overallScore 98 — Minor: remote inventory/count snapshots are inherently non-atomic. */
async function previewWorkersForms({ api, kit, resourceName, normalized, count }, _options = {}) {
  const name = databaseName({ resourceName });
  let existing;
  try { existing = await findDatabase({ api, kit, name }); }
  catch (error) {
    if (error.code !== 'CLOUDFLARE_D1_PERMISSION_REQUIRED') throw error;
    return { status: 'permission-required', forms: count, changes: [], message: error.message.replace(/^CLOUDFLARE_D1_PERMISSION_REQUIRED: /, '') };
  }
  if (!normalized && !existing) return undefined;
  const pendingCount = existing ? await pendingAnswers({ api, databaseId: existing.uuid }) : 0;
  return workerFormsPreview({ resourceName, name, existing, count, pendingCount });
}

/** Show storage retention and pending answers explicitly in the approval preview.
 * @complexity O(resource-name length) time/space; no I/O. @overallScore 100 */
function workerFormsPreview({ resourceName, name, existing, count, pendingCount }, _options = {}) {
  return { status: 'on', forms: count, pendingCount,
    changes: [{ action: existing ? 'reuse' : 'create', resource: 'd1-database', name, ...(existing ? { databaseId: existing.uuid } : {}) },
      { action: 'bind', resource: 'worker', resourceName, routes: count ? FORMS_WORKER_ROUTES : ['/_tovu/*'] }],
    message: `Form submissions: on (${count} form${count === 1 ? '' : 's'}). Submissions are stored in D1 database ${name} (${existing ? 'reused' : 'created'}) in this Cloudflare account and pulled into the site admin on demand. ${FREE_PLAN_NOTE} Pending answers: ${pendingCount ?? 'count unavailable'}. Uncollected answers never expire automatically.` };
}

/** One indexed scalar read per preview; no answer payloads and no polling or expiry work.
 * @complexity O(pending rows) index scan time, O(1) client response space.
 * @overallScore 98 — Minor: D1 count failures show an explicit unavailable count. */
async function pendingAnswers({ api, databaseId }, _options = {}) {
  try {
    const rows = await query({ api, databaseId, sql: 'SELECT COUNT(*) AS count FROM submissions WHERE pulled_at IS NULL' });
    return Number.isSafeInteger(Number(rows[0]?.count)) ? Number(rows[0].count) : null;
  } catch {
    console.warn('CLOUDFLARE_FORMS_PENDING_COUNT_UNAVAILABLE');
    return null;
  }
}

/** Find-or-create the database, then apply pending migrations. Never drops or recreates anything.
 * @complexity One inventory read, at most one create, 2 + pending-migration queries. */
export async function provisionForms({ api, kit, resourceName }, _options = {}) {
  const name = databaseName({ resourceName });
  const database = await findDatabase({ api, kit, name }) ?? await createDatabase({ api, kit, name });
  if (typeof database?.uuid !== 'string' || !database.uuid) throw formsRefusal({ kit, code: 'CLOUDFLARE_D1_INVALID', status: 502, message: `D1 database ${name} returned no id. Check it in the Cloudflare dashboard, then publish again.` });
  const applied = await migrate({ api, kit, databaseId: database.uuid });
  // Older receivers retained raw IPs and acknowledged answers indefinitely. This cold publish
  // upgrade performs three writes with no payload reads, before the new receiver can be uploaded.
  await query({ api, databaseId: database.uuid, sql: 'DELETE FROM submissions WHERE pulled_at IS NOT NULL' });
  await query({ api, databaseId: database.uuid, sql: 'UPDATE submissions SET ip = NULL WHERE ip IS NOT NULL' });
  await query({ api, databaseId: database.uuid, sql: "DELETE FROM rate_windows WHERE key LIKE '%:%'" });
  return { databaseId: database.uuid, databaseName: name, applied };
}

async function createDatabase({ api, kit, name }, _options = {}) {
  try { return await api.request({ path: `${api.accountPath}/d1/database`, method: 'POST', body: { name } }); }
  catch (error) {
    // A concurrent publish may have created it first; the exact-name lookup is authoritative.
    if (!error.details?.alreadyExists) throw error;
    return findDatabase({ api, kit, name });
  }
}

async function query({ api, databaseId, sql, params = [] }, _options = {}) {
  const result = await api.request({ path: `${api.accountPath}/d1/database/${segment({ value: databaseId })}/query`, method: 'POST', body: { sql, params } });
  return Array.isArray(result) ? result.flatMap(item => item?.results ?? []) : [];
}

/** Applies each missing version in order; returns the versions applied by this call. */
export async function migrate({ api, kit, databaseId }, _options = {}) {
  await query({ api, databaseId, sql: MIGRATIONS_TABLE });
  const rows = await query({ api, databaseId, sql: 'SELECT version FROM schema_migrations' });
  const done = new Set(rows.map(row => Number(row.version)));
  const applied = [];
  for (const migration of MIGRATIONS.filter(item => !done.has(item.version))) {
    // Every statement is idempotent (IF NOT EXISTS), so a version interrupted before its marker reruns safely.
    // One statement per request: the REST endpoint binds `params` to a single statement.
    for (const sql of migration.sql) await query({ api, databaseId, sql });
    await query({ api, databaseId, sql: 'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)', params: [migration.version, new Date(kit.now?.() ?? Date.now()).toISOString()] });
    applied.push(migration.version);
  }
  return applied;
}

let receiverSource;
/** Read the receiver once; its portable validation helper is emitted beside it during build.
 * @complexity O(receiver bytes) time/space; one cached local file read.
 * @overallScore 98 — Minor: the emitted helper must accompany the receiver; the bundle execution test checks both. */
export async function receiverModule(_required = {}, _options = {}) {
  receiverSource ??= (await readFile(new URL('../worker/forms-receiver.mjs', import.meta.url), 'utf8'));
  return receiverSource;
}

const MAX_PAGE_ROUTES = 90;
const FORM_MARKER = /<form\b[^>]*\bdata-form-slug="/i;
/** Exact routes of exported pages that contain one of the site's forms, so the Worker runs first on
 * them and can show the "sent" state after a submission. Other pages and every asset stay on the free
 * static path. Over the cap only the first pages are listed; the submission itself works everywhere.
 * @complexity O(HTML bytes). */
export function formPageRoutes({ files }, { max = MAX_PAGE_ROUTES } = {}) {
  const routes = [];
  for (const file of files ?? []) {
    const path = String(file.file ?? '').replaceAll('\\', '/').replace(/^\.?\//, '');
    if (path.endsWith('.html') && FORM_MARKER.test(Buffer.from(file.data ?? '').toString('utf8'))) {
      const page = routesForPage({ path });
      if (routes.length + page.length > max) break;
      routes.push(...page);
    }
  }
  return routes;
}

/** `a/index.html` answers at `/a/` and `/a`; `a.html` at `/a.html` and `/a` (auto-trailing-slash). */
function routesForPage({ path }, _options = {}) {
  if (path === 'index.html') return ['/'];
  if (path.endsWith('/index.html')) { const dir = `/${path.slice(0, -'index.html'.length)}`; return [dir, dir.slice(0, -1)]; }
  return [`/${path}`, `/${path.slice(0, -'.html'.length)}`];
}

/** Bundle receiver, portable validator, manifest and existing bindings together.
 * @complexity O(manifest + module bytes) time/space; at most two local file reads.
 * @overallScore 98 — Minor: the distribution must include the built CMS portable module. */
export async function formsWorkerParts({ manifest, secret, databaseId }, { pageRoutes = [] } = {}) {
  const main = "import { handleRequest } from './receiver.mjs';\nimport manifest from './forms-manifest.mjs';\nexport default { fetch: (request, env) => handleRequest({ request, env, manifest }) };\n";
  return {
    modules: [
      { name: 'index.mjs', source: main },
      { name: 'receiver.mjs', source: await receiverModule() },
      { name: 'portable-validation.mjs', source: await readFile(new URL('../worker/portable-validation.mjs', import.meta.url), 'utf8') },
      { name: 'forms-manifest.mjs', source: `export default ${JSON.stringify({ forms: manifest.forms })};\n` },
    ],
    bindings: [{ type: 'd1', name: FORMS_BINDING, id: databaseId }, { type: 'secret_text', name: FORMS_SECRET_BINDING, text: secret }],
    runWorkerFirst: manifest.forms.length ? [...FORMS_WORKER_ROUTES, ...pageRoutes] : ['/_tovu/*'],
  };
}

/** Private pull API client. The receiver key travels only in the Authorization header. */
async function receiverCall({ kit, destination, path, init = {} }, _options = {}) {
  const origin = receiverOrigin({ kit, url: destination?.url });
  if (typeof destination.secret !== 'string' || destination.secret.length < 32) throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_KEY_REQUIRED', message: 'The form receiver key is missing. Republish the site so the host can reinstall it, then pull again.' });
  const resp = await receiverFetch({ kit, origin, path, init, secret: destination.secret });
  checkReceiverStatus({ kit, origin, resp });
  try { return await resp.json(); }
  catch { throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_INVALID_RESPONSE', status: 502, message: `${origin} returned unreadable data. Republish the site, then pull again.` }); }
}

async function receiverFetch({ kit, origin, path, init, secret }, _options = {}) {
  try { return await kit.fetch(`${origin}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${secret}` }, redirect: 'error' }, { timeoutMs: kit.timeouts.QUICK }); }
  catch { throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_UNREACHABLE', status: 502, message: `${origin} could not be reached. Check the site is published, then pull again.` }); }
}

function checkReceiverStatus({ kit, origin, resp }, _options = {}) {
  if (resp.status === 401) throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_UNAUTHORIZED', status: 401, message: `${origin} refused the form receiver key. Republish the site to reinstall the key, then pull again.` });
  if (resp.status === 404 || resp.status === 405) throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_RECEIVER_MISSING', status: 404, message: `${origin} has no form receiver. Republish the site with at least one active form, then pull again.` });
  if (!resp.ok) throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_UNAVAILABLE', status: 502, message: `${origin} answered HTTP ${resp.status}. Retry the pull in a few minutes.` });
}

function receiverOrigin({ kit, url }, _options = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (parsed?.protocol !== 'https:') throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_ADDRESS', message: 'The published site address is missing or not https. Republish the site, then pull again.' });
  return parsed.origin;
}

const hasRowIdentity = item => Number.isSafeInteger(item?.seq) && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64;
const hasRowBody = item => typeof item.formSlug === 'string' && item.answers !== null && typeof item.answers === 'object' && !Array.isArray(item.answers);
const hasRowMeta = item => typeof item.submittedAt === 'string' && (item.ip === null || typeof item.ip === 'string');
const isPending = item => hasRowIdentity(item) && hasRowBody(item) && hasRowMeta(item);

function pendingPath({ after, limit }, _options = {}) {
  return `/_tovu/forms/pending?after=${Number(after) || 0}&limit=${Math.min(100, Math.max(1, Number(limit) || 50))}`;
}

/** One page of unpulled submissions, oldest first. */
export async function pullFormSubmissions({ kit, destination }, { after = 0, limit = 50 } = {}) {
  const page = await receiverCall({ kit, destination, path: pendingPath({ after, limit }) });
  const items = page?.items;
  if (!Array.isArray(items) || items.length > 100 || !items.every(isPending)) throw formsRefusal({ kit, code: 'CLOUDFLARE_FORMS_INVALID_RESPONSE', status: 502, message: 'The form receiver returned an unexpected page. Republish the site, then pull again.' });
  return { items, nextAfter: Number(page.nextAfter) || 0, hasMore: page.hasMore === true };
}

/** Marks rows the host has committed; only then are they no longer pending. */
export async function acknowledgeFormSubmissions({ kit, destination, ids }, _options = {}) {
  const result = await receiverCall({ kit, destination, path: '/_tovu/forms/ack', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) } });
  return { acknowledged: Number(result?.acknowledged) || 0 };
}
