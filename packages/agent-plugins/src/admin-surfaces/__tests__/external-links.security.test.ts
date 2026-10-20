/**
 * @file Security pins (phase A) for host-mediated external links: a surface may only declare bare
 * https origins (bounded, unique), and an `open-link` message reaches the host's opener only from
 * this mount's frame, with this mount's nonce, for a well-formed https URL on a declared origin.
 * Every refusal names a code and never echoes the URL; the opener receives the parser's normalized
 * form, so the host never re-parses a string the gate judged differently.
 */
import { describe, expect, test } from 'vitest';
import { createAdminSurfaceClient } from '../surface-client.js';
import { openAdminSurfaceLink, parseAdminSurfacesFile, type AdminSurfaceDescriptor, type AdminSurfaceMessageEvent, type AdminSurfaceMountRecord } from '../index.js';

const surface = (overrides: Record<string, unknown> = {}) => ({ id: 'settings', title: 'Settings', entry: 'surface/index.html', ...overrides });
const raw = (overrides: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, surfaces: [surface(overrides)] });
function parseOne(overrides: Record<string, unknown> = {}): AdminSurfaceDescriptor {
  const parsed = parseAdminSurfacesFile({ raw: raw(overrides) });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors[0]!;
}
const reasonFor = (overrides: Record<string, unknown>) => {
  const parsed = parseAdminSurfacesFile({ raw: raw(overrides) });
  return parsed.ok ? 'accepted' : parsed.reason;
};

describe('declared link origins', () => {
  test('bare https origins are kept as declared', () => {
    expect(parseOne({ linkOrigins: ['https://accounts.example.com', 'https://docs.example.com:8443'] }).linkOrigins).toEqual(['https://accounts.example.com', 'https://docs.example.com:8443']);
  });
  test.each(['http://accounts.example.com', 'https://*.example.com', 'https://accounts.example.com/path', 'https://127.0.0.1', 'javascript:alert(1)', 'data:text/html,x', 'https://accounts.example.com:443', 'https://user@accounts.example.com', 42])('origin %j is refused', (origin) => {
    expect(reasonFor({ linkOrigins: [origin] })).toBe('surfaces[0].linkOrigins[0] must be a unique bare https origin (no wildcards, paths or keywords)');
  });
  test('a duplicate origin is refused', () => {
    expect(reasonFor({ linkOrigins: ['https://a.example.com', 'https://a.example.com'] })).toBe('surfaces[0].linkOrigins[1] must be a unique bare https origin (no wildcards, paths or keywords)');
  });
  test('more than 8 origins are refused', () => {
    const origins = Array.from({ length: 9 }, (_, index) => `https://h${index}.example.com`);
    expect(reasonFor({ linkOrigins: origins })).toBe('surfaces[0].linkOrigins must be an array of at most 8');
  });
});

describe('open-link gate', () => {
  const frame = {};
  const mount: AdminSurfaceMountRecord = { mountId: 'nonce-1', frame, descriptor: parseOne({ linkOrigins: ['https://accounts.example.com'] }) };
  const message = (overrides: Record<string, unknown> = {}) => ({ protocol: 'jini.admin-surface', version: 1, kind: 'open-link', mountId: 'nonce-1', requestId: 'r1', url: 'https://accounts.example.com/permissions', ...overrides });
  const event = (overrides: Partial<AdminSurfaceMessageEvent> = {}, data: unknown = message()): AdminSurfaceMessageEvent => ({ origin: 'null', source: frame, data, ...overrides });
  function opener(optional: { readonly fails?: boolean } = {}) {
    const opened: string[] = [];
    const openLink = async ({ url }: { readonly url: string }) => { if (optional.fails) throw new Error('shell refused https://accounts.example.com/secret'); opened.push(url); };
    return { opened, openLink };
  }
  const refusal = (code: string, text: string, retryable = false) => ({
    ok: false, refused: code,
    response: { protocol: 'jini.admin-surface', version: 1, kind: 'action-response', mountId: 'nonce-1', requestId: 'r1', ok: false, error: { code, message: text, retryable } },
  });

  test('a declared https link is handed to the host opener in normalized form and answered', async () => {
    const { opened, openLink } = opener();
    const verdict = await openAdminSurfaceLink({ event: event({}, message({ url: 'https://ACCOUNTS.example.com:443/permissions?x=1' })), mount, openLink });
    expect(opened).toEqual(['https://accounts.example.com/permissions?x=1']);
    expect(verdict).toEqual({ ok: true, url: 'https://accounts.example.com/permissions?x=1', response: { protocol: 'jini.admin-surface', version: 1, kind: 'action-response', mountId: 'nonce-1', requestId: 'r1', ok: true, result: null } });
  });
  test('an undeclared origin is refused without opening or echoing the URL', async () => {
    const { opened, openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({}, message({ url: 'https://evil.example.net/phish' })), mount, openLink }))
      .toEqual(refusal('link-undeclared', 'This surface did not declare that link destination.'));
    expect(opened).toEqual([]);
  });
  test('a surface that declares no link origins can open nothing', async () => {
    const { opened, openLink } = opener();
    const bare: AdminSurfaceMountRecord = { ...mount, descriptor: parseOne() };
    expect(await openAdminSurfaceLink({ event: event(), mount: bare, openLink })).toEqual(refusal('link-undeclared', 'This surface did not declare that link destination.'));
    expect(opened).toEqual([]);
  });
  test.each(['http://accounts.example.com/permissions', 'javascript:alert(document.domain)', 'data:text/html,<script>alert(1)</script>', 'JAVASCRIPT://accounts.example.com/%0aalert(1)'])('non-https link %j is refused', async (url) => {
    const { opened, openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({}, message({ url })), mount, openLink })).toEqual(refusal('link-not-https', 'Only https links can be opened.'));
    expect(opened).toEqual([]);
  });
  test.each(['not a url', 'https://user:pass@accounts.example.com/permissions'])('malformed or credential-carrying link %j is refused', async (url) => {
    const { opened, openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({}, message({ url })), mount, openLink })).toEqual(refusal('link-invalid', 'That link is not a valid web address.'));
    expect(opened).toEqual([]);
  });
  test('a link longer than 2048 characters is refused', async () => {
    const { opened, openLink } = opener();
    const url = `https://accounts.example.com/${'a'.repeat(2048 - 'https://accounts.example.com/'.length + 1)}`;
    expect(await openAdminSurfaceLink({ event: event({}, message({ url })), mount, openLink })).toEqual(refusal('link-too-long', 'The link is too long.'));
    expect(opened).toEqual([]);
  });
  test('a link of exactly 2048 characters is opened', async () => {
    const { opened, openLink } = opener();
    const url = `https://accounts.example.com/${'a'.repeat(2048 - 'https://accounts.example.com/'.length)}`;
    await openAdminSurfaceLink({ event: event({}, message({ url })), mount, openLink });
    expect(opened).toEqual([url]);
  });
  test('a wrong mount nonce is ignored and opens nothing', async () => {
    const { opened, openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({}, message({ mountId: 'nonce-2' })), mount, openLink })).toEqual({ ok: false, ignored: 'mount-mismatch' });
    expect(opened).toEqual([]);
  });
  test('another sandboxed frame is ignored', async () => {
    const { openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({ source: {} }), mount, openLink })).toEqual({ ok: false, ignored: 'source-mismatch' });
  });
  test('a non-sandboxed origin is ignored', async () => {
    const { openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({ origin: 'https://accounts.example.com' }), mount, openLink })).toEqual({ ok: false, ignored: 'origin-mismatch' });
  });
  test.each([
    ['an action request', { kind: 'action-request' }],
    ['a non-string url', { url: 42 }],
    ['a malformed request id', { requestId: 'has space' }],
  ])('%s is not an open-link message', async (_label, overrides) => {
    const { openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({}, message(overrides)), mount, openLink })).toEqual({ ok: false, ignored: 'not-an-open-link' });
  });
  test.each(['open-link', null])('non-object message data %j is not an open-link message', async (data) => {
    const { openLink } = opener();
    expect(await openAdminSurfaceLink({ event: event({}, data), mount, openLink })).toEqual({ ok: false, ignored: 'not-an-open-link' });
  });
  test('an opener failure is answered as retryable without its raw text', async () => {
    const { openLink } = opener({ fails: true });
    expect(await openAdminSurfaceLink({ event: event(), mount, openLink })).toEqual(refusal('link-failed', 'The host could not open the link. Try again.', true));
  });
});

test('the surface client posts open-link only to the host origin learned from init and rejects with the host refusal', async () => {
  const posted: Array<{ readonly message: unknown; readonly targetOrigin: string }> = [];
  const parent = { postMessage(message: unknown, targetOrigin: string) { posted.push({ message, targetOrigin }); } };
  let deliver: (event: { readonly origin: string; readonly source: unknown; readonly data: unknown }) => void = () => {};
  const client = createAdminSurfaceClient({ parent, listen: (handler) => { deliver = handler; return () => {}; } });
  const base = { protocol: 'jini.admin-surface', version: 1, mountId: 'nonce-1' };
  deliver({ origin: 'https://host.example.com', source: parent, data: { ...base, kind: 'init' } });
  const pending = client.openLink({ url: 'https://elsewhere.example.net/' });
  await Promise.resolve();
  expect(posted).toEqual([{ message: { ...base, kind: 'open-link', requestId: 'r1', url: 'https://elsewhere.example.net/' }, targetOrigin: 'https://host.example.com' }]);
  deliver({ origin: 'https://host.example.com', source: parent, data: { ...base, kind: 'action-response', requestId: 'r1', ok: false, error: { code: 'link-undeclared', message: 'This surface did not declare that link destination.', retryable: false } } });
  await expect(pending).rejects.toMatchObject({ name: 'AdminSurfaceCallError', code: 'link-undeclared' });
  client.close();
});
