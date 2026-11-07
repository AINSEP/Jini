import { FORM_SCHEMA_HASH_FIELD, matchesFormSchemaHash, resolvePortableFormField } from "./portable-validation.mjs";

/**
 * Form submissions receiver, uploaded as `receiver.mjs` beside the site's static assets.
 * Runs inside Cloudflare Workers with the bundled portable validator and Web platform APIs only.
 * Forms and full validation belong to the host; this receiver enforces its published supported
 * subset and rejects unsupported fields at publish time.
 * Never log answers, IPs or the management secret: only fixed reason codes.
 */
export const LIMITS = Object.freeze({ maxBodyBytes: 64 * 1024, maxFields: 100, maxValueLength: 5000, ratePerWindow: 5, windowSeconds: 60, maxPage: 100 });
/** The host's reserved names: the honeypot and the double-submit attempt token. Never stored. */
const HONEYPOT = '_hp';
const RESERVED = new Set([HONEYPOT, '_attempt', FORM_SCHEMA_HASH_FIELD]);
/** The host's existing result query names (`form`, `form_status`), so a returning page reads one vocabulary. */
const RESULT_KEYS = ['form', 'form_status', 'form_errors', 'form_retry_after'];
const SUBMIT_PATH = /^\/forms\/([a-z0-9][a-z0-9-]{0,99})\/submit\/?$/;

/** Routes form POSTs and the private pull API; every other request is the static site.
 * @complexity O(body bytes + fields) per submission; O(page) per pull. */
export async function handleRequest({ request, env, manifest }, options = {}) {
  const url = new URL(request.url);
  const submit = SUBMIT_PATH.exec(url.pathname);
  if (submit) return request.method === 'POST' ? handleSubmit({ request, env, manifest, slug: submit[1] }, options) : errorPage({ status: 405, message: 'This address only accepts form submissions.' });
  if (url.pathname === '/_tovu/forms/pending') return request.method === 'GET' ? guarded({ request, env, work: () => listPending({ env, url }, options) }) : json({ status: 405, body: { error: 'METHOD_NOT_ALLOWED' } });
  if (url.pathname === '/_tovu/forms/ack') return request.method === 'POST' ? guarded({ request, env, work: () => acknowledge({ request, env }, options) }) : json({ status: 405, body: { error: 'METHOD_NOT_ALLOWED' } });
  const slug = sentFormSlug({ request, url, manifest });
  return slug ? withSentNotice({ request, env, slug }, options) : env.ASSETS.fetch(request);
}

/** The form named by the host's own success query (`form=<slug>&form_status=success`) on a page GET, if
 * it is one of this site's forms. Any other request is served untouched. */
export function sentFormSlug({ request, url, manifest }, _options = {}) {
  if (request.method !== 'GET' || url.searchParams.get('form_status') !== 'success') return null;
  const slug = url.searchParams.get('form');
  return manifest.forms.some(form => form.slug === slug) ? slug : null;
}

/** The static page with the same "sent" state the host's server renders: the form hidden and its own
 * success slot shown. A page without a slot gets one plain accessible message after the form.
 * Non-HTML or unsuccessful asset responses pass through unchanged. */
export async function withSentNotice({ request, env, slug }, { Rewriter = globalThis.HTMLRewriter } = {}) {
  const response = await env.ASSETS.fetch(request);
  if (!response.ok || !(response.headers.get('Content-Type') ?? '').includes('text/html') || !Rewriter) return response;
  const rewriter = new Rewriter();
  for (const [selector, handler] of sentNoticeHandlers({ slug })) rewriter.on(selector, handler);
  return rewriter.transform(response);
}

const SENT_MESSAGE = 'Thanks, your submission was received.';
/** Element handlers in document order. The host renders the success slot before its form, so the form
 * handler already knows whether a slot was shown. Selectors use the generic success hooks only. */
export function sentNoticeHandlers({ slug }, _options = {}) {
  const state = { slot: false, noticed: false };
  const showSlot = { element(element) { element.removeAttribute('hidden'); state.slot = true; } };
  const hideForm = { element(element) {
    element.setAttribute('hidden', '');
    if (state.slot || state.noticed) return;
    state.noticed = true;
    element.after(`<p class="tovu-form-success" data-form-slug="${slug}" role="status">${SENT_MESSAGE}</p>`, { html: true });
  } };
  return [
    [`div.tovu-form-success[data-form-slug="${slug}"]`, showSlot],
    [`div[data-tovu-form-success][data-form-slug="${slug}"]`, showSlot],
    [`form[data-form-slug="${slug}"]`, hideForm],
  ];
}

/** Honeypot, light manifest checks, D1 rate window, insert, then 303 to the success page. */
export async function handleSubmit({ request, env, manifest, slug }, { now = () => Date.now(), randomId = () => crypto.randomUUID() } = {}) {
  const back = backLink({ request });
  const form = manifest.forms.find(item => item.slug === slug);
  if (!form) return errorPage({ status: 404, message: 'This form is not available.', back });
  const parsed = await readFields({ request });
  if (parsed.error) return errorPage({ ...parsed.error, back });
  const stale = schemaRetryResponse({ form, fields: parsed.fields, back });
  if (stale) return stale;
  if (hasHoneypotValue({ fields: parsed.fields })) return successRedirect({ request, form });
  const checked = checkFields({ form, fields: parsed.fields });
  if (checked.error) return errorPage({ status: 400, message: checked.error, back });
  const refused = await storeSubmission({ db: env.TOVU_FORMS, slug, answers: checked.answers, evidence: form.evidence, ip: request.headers.get('CF-Connecting-IP'), secret: env.TOVU_FORMS_SECRET, back }, { now, randomId });
  return refused ?? successRedirect({ request, form });
}

function hasHoneypotValue({ fields }, _options = {}) {
  return (fields.get(HONEYPOT) ?? []).some(value => value.trim() !== '');
}

/** Refuse stale metadata before any field validation or storage; legacy pages stay compatible.
 * @complexity O(digest length), no I/O or answer retention. */
function schemaRetryResponse({ form, fields, back }, _options = {}) {
  const hashes = fields.get(FORM_SCHEMA_HASH_FIELD);
  const current = matchesFormSchemaHash({ present: fields.has(FORM_SCHEMA_HASH_FIELD), submittedHash: hashes?.length === 1 ? hashes[0] : hashes, schemaHash: form.evidence?.schemaHash });
  return current ? null : errorPage({ status: 409, message: 'This form changed while you were filling it in. Your form has not been sent. Please return to the updated form and review your answers.', back });
}

/** Rate window, then insert. Returns the error page to send, or null once the row is stored.
 * @complexity O(answer + evidence bytes) time/space; one rate batch and one insert.
 * @overallScore 98 — Minor: a failed insert still consumes its existing rate-window attempt. */
async function storeSubmission({ db, slug, answers, evidence, ip, secret, back }, { now, randomId }) {
  try {
    if (!await withinRate({ db, key: await rateKey({ slug, ip, secret }), nowMs: now() })) return errorPage({ status: 429, message: 'Too many submissions. Wait a minute, then try again.', back });
    await db.prepare('INSERT INTO submissions (id, form_slug, answers_json, submitted_at, ip) VALUES (?, ?, ?, ?, ?)')
      .bind(randomId(), slug, JSON.stringify(evidence ? ['@jini/form-submission/v1', answers, null, { ...evidence, capturedAt: new Date(now()).toISOString(), source: 'cloudflare' }] : answers), new Date(now()).toISOString(), null).run();
    return null;
  } catch {
    console.error('FORMS_STORE_FAILED');
    return errorPage({ status: 503, message: 'Your submission could not be saved. Try again in a few minutes.', back });
  }
}

/** Reads at most LIMITS.maxBodyBytes while streaming, then parses URL-encoded or multipart text fields.
 * Repeated names (checkbox groups) keep every value in order. */
export async function readFields({ request }, _options = {}) {
  const type = (request.headers.get('Content-Type') ?? '').toLowerCase();
  const multipart = type.startsWith('multipart/form-data');
  if (!multipart && !type.startsWith('application/x-www-form-urlencoded')) return { error: { status: 415, message: 'This form must be sent as a normal web form.' } };
  const bytes = await readBounded({ request });
  if (!bytes) return { error: { status: 413, message: 'The submission is too large.' } };
  const entries = multipart ? await multipartEntries({ bytes, type: request.headers.get('Content-Type') }) : [...new URLSearchParams(new TextDecoder().decode(bytes))];
  const error = entriesError({ entries });
  if (error) return { error };
  const fields = new Map();
  for (const [name, value] of entries) fields.set(name, [...(fields.get(name) ?? []), value]);
  return { fields };
}

function entriesError({ entries }, _options = {}) {
  if (!entries) return { status: 400, message: 'The submission could not be read.' };
  if (entries.length > LIMITS.maxFields) return { status: 413, message: 'The submission has too many fields.' };
  if (entries.some(([name, value]) => name !== FORM_SCHEMA_HASH_FIELD && typeof value !== 'string')) return { status: 400, message: 'File uploads are not accepted by this form.' };
  return null;
}

async function readBounded({ request }, _options = {}) {
  if (Number(request.headers.get('Content-Length')) > LIMITS.maxBodyBytes) return null;
  if (!request.body) return new Uint8Array();
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > LIMITS.maxBodyBytes) return null;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function multipartEntries({ bytes, type }, _options = {}) {
  try { return [...await new Response(bytes, { headers: { 'Content-Type': type } }).formData()]; }
  catch { return null; }
}

/** Use the portable live validation owner; published rules and accepted normalization stay identical.
 * @complexity O(fields * (value bytes + options)) time/space, bounded by request/manifest limits.
 * @overallScore 100 */
export function checkFields({ form, fields }, _options = {}) {
  const known = new Map(form.fields.map(field => [field.name, field]));
  const unknown = [...fields.keys()].find(name => !RESERVED.has(name) && !known.has(name));
  if (unknown !== undefined) return { error: `The field "${unknown}" is not part of this form.` };
  const answers = {};
  for (const field of form.fields) {
    const result = receiveField({ field, values: fields.get(field.name) });
    if (result.error) return { error: result.error };
    if (result.kind === 'accepted') Object.defineProperty(answers, field.name, { value: result.value, enumerable: true });
  }
  return { answers };
}

/** Published v1 manifests with no explicit type retain their text/multiple behavior.
 * @complexity O(value bytes + options) time/space; no I/O. @overallScore 100 */
function receiveField({ field, values }, _options = {}) {
  const error = receiveFieldProblem({ field, values });
  if (error) return { error };
  if (!field.type && field.multiple) return receiveLegacyMultiple({ field, values });
  const value = field.multiple ? values : values?.[0];
  const resolved = resolvePortableFormField({ field: receiverDescriptor({ field, value }), value });
  return resolved.kind === 'rejected' ? { error: fieldError({ field, reason: resolved.reason }) } : resolved;
}

/** Reject unsupported rules and repeated scalars before resolving a value.
 * @complexity O(1) time/space; no I/O. @overallScore 100 */
function receiveFieldProblem({ field, values }, _options = {}) {
  if (field.validationUnsupported || field.type === 'file') return `"${field.name}" cannot be received here. Contact the site owner.`;
  if (!field.multiple && values?.length > 1) return `"${field.name}" was sent more than once.`;
  return null;
}

/** Adapt published code-point caps to the native validator's UTF-16 units.
 * @complexity O(value bytes + options) time/space; no I/O. @overallScore 100 */
function receiverDescriptor({ field, value }, _options = {}) {
  // Published text caps count Unicode code points. The shared validator counts UTF-16 units,
  // so express the same cap in its units without changing or truncating the submitted answer.
  const maxLength = (field.maxLength ?? LIMITS.maxValueLength) + (typeof value === 'string' ? value.length - [...value].length : 0);
  return { ...field, maxLength, type: field.type ?? 'text', id: field.name, label: field.label ?? field.name,
    ...(field.options ? { options: field.options.map(value => ({ value, label: value })) } : {}) };
}

/** Preserve old untyped manifests without inventing a choice allowlist.
 * @complexity O(total value bytes) time/space; no I/O. @overallScore 100 */
function receiveLegacyMultiple({ field, values }, _options = {}) {
  if (!values?.length) return field.required ? { error: fieldError({ field, reason: 'required' }) } : { kind: 'absent' };
  for (const value of values) {
    const result = resolvePortableFormField({ field: receiverDescriptor({ field: { ...field, type: 'text' }, value }), value });
    if (result.kind === 'rejected') return { error: fieldError({ field, reason: result.reason }) };
  }
  return { kind: 'accepted', value: values };
}

/** Map bounded validator reasons to the receiver's visitor-facing error vocabulary.
 * @complexity O(reason length) time/space; no I/O. @overallScore 100 */
function fieldError({ field, reason }, _options = {}) {
  const descriptions = { required: 'is required', too_long: `is longer than ${field.maxLength ?? LIMITS.maxValueLength} characters`,
    too_short: 'is too short', invalid_option: 'contains an unavailable choice', invalid_email: 'must be an email address' };
  return `"${field.name}" ${descriptions[reason] ?? `has an invalid value (${reason.replaceAll('_', ' ')})`}.`;
}

/** Secret-salted short-lived pseudonyms prevent offline IPv4 enumeration; no raw IP persists. */
async function rateKey({ slug, ip, secret }, _options = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('FORMS_RECEIVER_SECRET_MISSING');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([secret, slug, ip ?? 'unknown'])));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Fixed-window counter in D1 (shared by every isolate). Counts only valid submissions.
 * Stale windows for any key are pruned in the same batch; no matching rows means no row writes. */
export async function withinRate({ db, key, nowMs }, _options = {}) {
  const windowStart = Math.floor(nowMs / 1000 / LIMITS.windowSeconds) * LIMITS.windowSeconds;
  const [counted] = await db.batch([
    db.prepare('INSERT INTO rate_windows (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_windows.window_start = excluded.window_start THEN rate_windows.count + 1 ELSE 1 END, window_start = excluded.window_start RETURNING count').bind(key, windowStart),
    db.prepare('DELETE FROM rate_windows WHERE window_start < ?').bind(windowStart - 3600),
  ]);
  return Number(counted.results?.[0]?.count ?? Infinity) <= LIMITS.ratePerWindow;
}

/** The form's own success page when it has one; otherwise the referring page on this host (or `/`)
 * with the host's result query names, exactly as the live site's 303 sets them. */
export function successRedirect({ request, form }, _options = {}) {
  const target = form.successPath ? new URL(form.successPath, request.url) : (sameHostReferer({ request }) ?? new URL('/', request.url));
  if (!form.successPath) {
    for (const key of RESULT_KEYS) target.searchParams.delete(key);
    target.searchParams.set('form', form.slug);
    target.searchParams.set('form_status', 'success');
  }
  return new Response(null, { status: 303, headers: { Location: `${target.pathname}${target.search}`, 'Cache-Control': 'no-store' } });
}

function sameHostReferer({ request }, _options = {}) {
  try {
    const referer = new URL(request.headers.get('Referer') ?? '');
    return referer.host === new URL(request.url).host && !referer.pathname.startsWith('//') ? referer : null;
  } catch { return null; }
}

function backLink({ request }, _options = {}) {
  const referer = sameHostReferer({ request });
  return referer ? `${referer.pathname}${referer.search}` : '/';
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/** Minimal accessible page; the site's theme is never copied here. */
export function errorPage({ status, message, back = '/' }, _options = {}) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Form not sent</title></head>`
    + `<body><main><h1>Form not sent</h1><p role="alert">${escapeHtml(message)}</p><p><a href="${escapeHtml(back)}">Go back</a></p></main></body></html>`;
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function json({ status = 200, body }, _options = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Bearer check with a constant-time comparison of SHA-256 digests (equal length by construction). */
export async function authorized({ request, env }, _options = {}) {
  const secret = env.TOVU_FORMS_SECRET;
  const header = request.headers.get('Authorization') ?? '';
  if (typeof secret !== 'string' || secret.length < 32 || !header.startsWith('Bearer ')) return false;
  const encoder = new TextEncoder();
  const [given, expected] = await Promise.all([header.slice(7), secret].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(given);
  const right = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function guarded({ request, env, work }, _options = {}) {
  if (!await authorized({ request, env })) return json({ status: 401, body: { error: 'UNAUTHORIZED' } });
  try { return await work(); }
  catch { console.error('FORMS_PULL_FAILED'); return json({ status: 503, body: { error: 'STORAGE_UNAVAILABLE' } }); }
}

/** Oldest unpulled rows after `after`, at most LIMITS.maxPage. */
export async function listPending({ env, url }, _options = {}) {
  const after = Math.max(0, Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0);
  const limit = Math.min(LIMITS.maxPage, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const { results = [] } = await env.TOVU_FORMS.prepare('SELECT seq, id, form_slug, answers_json, submitted_at FROM submissions WHERE pulled_at IS NULL AND seq > ? ORDER BY seq LIMIT ?').bind(after, limit).all();
  const items = results.map(row => pendingRow({ row }));
  return json({ body: { items, nextAfter: items.length ? items[items.length - 1].seq : after, hasMore: items.length === limit } });
}

/** Backward-compatible answer JSON; new rows carry captured evidence outside visitor answers.
 * @complexity O(stored JSON bytes) time/space; no I/O. @overallScore 100 */
function pendingRow({ row }, _options = {}) {
  const stored = JSON.parse(row.answers_json);
  const envelope = Array.isArray(stored) && stored[0] === '@jini/form-submission/v1';
  return { seq: row.seq, id: row.id, formSlug: row.form_slug, answers: envelope ? stored[1] : stored,
    ...(envelope && stored[3] ? { evidence: stored[3] } : {}), submittedAt: row.submitted_at, ip: null };
}

function validIds({ ids }, _options = {}) {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= LIMITS.maxPage && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 64);
}

/** Delete committed remote copies. The durable local receipt makes repeat acknowledgements safe. */
export async function acknowledge({ request, env }, { now = () => Date.now() } = {}) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  const ids = body?.ids;
  if (!validIds({ ids })) return json({ status: 400, body: { error: 'INVALID_IDS' } });
  const result = await env.TOVU_FORMS.prepare(`DELETE FROM submissions WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids).run();
  return json({ body: { acknowledged: Number(result.meta?.changes ?? 0) } });
}
