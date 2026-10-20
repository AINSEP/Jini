/**
 * @file Security pins for admin surfaces (phase A): path containment, the sandbox attribute, the CSP
 * string and its extra-source validation, the host-page message gate, the server-side dispatcher's
 * refusals, the surface client's trust rules and the bootstrap's no-store/expiry contract.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PackagePathViolation } from '../../lifecycle/package-paths.js';
import { readTrustedPluginFile } from '../../lifecycle/__tests__/test-support.js';
import {
  AdminSurfaceActionError, adminSurfaceBootstrapHeaders, adminSurfaceContentSecurityPolicy, adminSurfaceFileHeaders,
  adminSurfaceFrameAttributes, createAdminSurfaceActionDispatcher, createAdminSurfaceBootstrap, createAdminSurfaceMount,
  isAdminSurfaceBootstrapCurrent, parseAdminSurfacesFile, readAdminSurfaceFile, validateAdminSurfaceMessage,
  type AdminSurfaceDescriptor, type AdminSurfaceMessageEvent, type AdminSurfaceMountRecord,
} from '../index.js';
import { createAdminSurfaceClient, type AdminSurfaceIncomingMessage } from '../surface-client.js';

const input = { type: 'object', properties: { name: { type: 'string', maxLength: 20 } }, required: ['name'] } as const;
const surface = (overrides: Record<string, unknown> = {}) => ({ id: 'settings', title: 'Settings', entry: 'surface/index.html', files: ['surface/app.mjs'], actions: [{ name: 'save', input }], ...overrides });
const file = (surfaces: unknown[]) => JSON.stringify({ schemaVersion: 1, surfaces });
function parseOne(overrides: Record<string, unknown> = {}): AdminSurfaceDescriptor {
  const parsed = parseAdminSurfacesFile({ raw: file([surface(overrides)]) });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors[0]!;
}
const reasonFor = (overrides: Record<string, unknown>) => {
  const parsed = parseAdminSurfacesFile({ raw: file([surface(overrides)]) });
  return parsed.ok ? 'accepted' : parsed.reason;
};

describe('contained paths', () => {
  test.each(['../index.html', '/abs/index.html', 'surface\\index.html', 'surface//index.html', './index.html', 'surface/../index.html', '%2e%2e/index.html', '.hidden/index.html', 'index.htm'])('entry %j is refused', (entry) => {
    expect(reasonFor({ entry })).toBe('surfaces[0].entry must be a plain relative path ending in .html');
  });
  test.each(['../app.mjs', '/app.mjs', 'app.exe', 'surface/../../app.mjs', 'app.html'])('file %j is refused', (bad) => {
    expect(reasonFor({ files: [bad] })).toBe('surfaces[0].files[0] must be a plain relative path ending in .mjs, .js, .css, .json');
  });
  test('only the entry and declared files are read; anything else is refused without I/O', async () => {
    const reads: string[] = [];
    const loaded = { plugin: { pluginId: 'acme', packageRoot: '/p' }, descriptor: parseOne() };
    const readFile = async ({ filename }: { readonly filename: string }) => { reads.push(filename); return 'body'; };
    expect(await readAdminSurfaceFile({ surface: loaded, path: 'surface/../secret.json', readFile })).toEqual({ ok: false, reason: 'not-declared' });
    expect(await readAdminSurfaceFile({ surface: loaded, path: 'plugin.json', readFile })).toEqual({ ok: false, reason: 'not-declared' });
    expect(reads).toEqual([]);
    expect(await readAdminSurfaceFile({ surface: loaded, path: 'surface/app.mjs', readFile })).toMatchObject({ ok: true, body: 'body' });
    expect(reads).toEqual(['surface/app.mjs']);
  });
});

test('a declared file that is a symlink out of the plugin root is refused on disk', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'admin-surface-escape-'));
  try {
    const root = path.join(base, 'plugin');
    await mkdir(path.join(root, 'surface'), { recursive: true });
    await writeFile(path.join(base, 'outside.mjs'), 'export const secret = 1;');
    await symlink(path.join(base, 'outside.mjs'), path.join(root, 'surface/app.mjs'));
    const loaded = { plugin: { pluginId: 'acme', packageRoot: root }, descriptor: parseOne() };
    await expect(readAdminSurfaceFile({ surface: loaded, path: 'surface/app.mjs', readFile: ({ plugin, filename }) => readTrustedPluginFile(plugin, filename) })).rejects.toBeInstanceOf(PackagePathViolation);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

describe('sandboxed iframe contract', () => {
  test('sandbox is exactly allow-scripts, never allow-same-origin', () => {
    const attributes = adminSurfaceFrameAttributes({ src: '/s/index.html', title: 'Settings' });
    expect(attributes).toEqual({ src: '/s/index.html', title: 'Settings', sandbox: 'allow-scripts', referrerPolicy: 'no-referrer' });
  });
  test('the default CSP is strict and closes network and framing', () => {
    expect(adminSurfaceContentSecurityPolicy({ descriptor: parseOne() })).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts",
    );
  });
  test('declared, validated origins extend only their own directive', () => {
    const descriptor = parseOne({ csp: { 'connect-src': ['https://api.example.com'], 'script-src': ['https://cdn.example.com:8443'] } });
    expect(adminSurfaceContentSecurityPolicy({ descriptor })).toBe(
      "default-src 'none'; script-src 'self' https://cdn.example.com:8443; style-src 'self'; img-src 'self'; font-src 'self'; connect-src https://api.example.com; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts",
    );
  });
  test.each([
    'http://api.example.com', 'https://*.example.com', '*', "'unsafe-inline'", "'unsafe-eval'", 'https://api.example.com/path',
    'https://api.example.com:443', 'https://user@api.example.com', 'https://127.0.0.1', 'data:', 'https://API.example.com',
    'https://api.example.com; script-src *', 'https://api.example.com ', 'blob:',
  ])('extra CSP source %j refuses the file', (source) => {
    expect(reasonFor({ csp: { 'connect-src': [source] } })).toBe("surfaces[0].csp['connect-src'] may only list bare https origins (no wildcards, paths or keywords)");
  });
  test.each(['default-src', 'sandbox', 'frame-ancestors', 'form-action', '__proto__'])('directive %j cannot be extended', (directive) => {
    expect(reasonFor({ csp: JSON.parse(`{${JSON.stringify(directive)}:["https://a.example.com"]}`) })).toBe(`surfaces[0].csp may not extend '${directive}'`);
  });
  test('served script files get the CSP, nosniff and a credential-free CORS grant; html gets no CORS', () => {
    const descriptor = parseOne();
    const csp = adminSurfaceContentSecurityPolicy({ descriptor });
    expect(adminSurfaceFileHeaders({ descriptor, path: 'surface/app.mjs' })).toEqual({
      'Content-Type': 'text/javascript; charset=utf-8', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
    });
    expect(adminSurfaceFileHeaders({ descriptor, path: 'surface/index.html' })).not.toHaveProperty('Access-Control-Allow-Origin');
  });
});

describe('action schemas are a closed subset', () => {
  test.each([
    [{ type: 'string', pattern: '.*' }, "surfaces[0].actions[0].input uses unsupported keyword 'pattern'"],
    [{ type: 'object', additionalProperties: true }, 'surfaces[0].actions[0].input additionalProperties may only be false (objects are closed)'],
    [{ properties: {} }, 'surfaces[0].actions[0].input must declare a supported type'],
    [{ type: 'object', required: ['missing'] }, 'surfaces[0].actions[0].input required must list declared properties'],
  ])('declaration %j is refused', (schema, reason) => {
    expect(reasonFor({ actions: [{ name: 'save', input: schema }] })).toBe(reason);
  });
});

describe('host-page message gate', () => {
  const frame = {};
  const mount: AdminSurfaceMountRecord = { mountId: 'nonce-1', frame, descriptor: parseOne() };
  const request = (overrides: Record<string, unknown> = {}) => ({ protocol: 'jini.admin-surface', version: 1, kind: 'action-request', mountId: 'nonce-1', requestId: 'r1', action: 'save', payload: { name: 'x' }, ...overrides });
  const event = (overrides: Partial<AdminSurfaceMessageEvent> = {}, data = request()): AdminSurfaceMessageEvent => ({ origin: 'null', source: frame, data, ...overrides });

  test('a well-formed request from this mount passes', () => {
    expect(validateAdminSurfaceMessage({ event: event(), mount })).toEqual({ ok: true, request: request() });
  });
  test('a different origin is ignored', () => {
    expect(validateAdminSurfaceMessage({ event: event({ origin: 'https://evil.example.com' }), mount })).toEqual({ ok: false, ignored: 'origin-mismatch' });
  });
  test('a declared expected origin replaces "null"', () => {
    expect(validateAdminSurfaceMessage({ event: event(), mount: { ...mount, expectedOrigin: 'https://surfaces.example.com' } })).toEqual({ ok: false, ignored: 'origin-mismatch' });
  });
  test('another sandboxed frame (same "null" origin, different window) is ignored', () => {
    expect(validateAdminSurfaceMessage({ event: event({ source: {} }), mount })).toEqual({ ok: false, ignored: 'source-mismatch' });
  });
  test('a wrong mount nonce is ignored', () => {
    expect(validateAdminSurfaceMessage({ event: event({}, request({ mountId: 'nonce-2' })), mount })).toEqual({ ok: false, ignored: 'mount-mismatch' });
  });
  test('a malformed envelope is ignored', () => {
    expect(validateAdminSurfaceMessage({ event: event({}, request({ requestId: 'has space' })), mount })).toEqual({ ok: false, ignored: 'not-an-action-request' });
  });
  test('an undeclared action is refused with a response', () => {
    const verdict = validateAdminSurfaceMessage({ event: event({}, request({ action: 'delete-everything' })), mount });
    expect(verdict).toMatchObject({ ok: false, refused: 'action-undeclared', response: { kind: 'action-response', mountId: 'nonce-1', requestId: 'r1', ok: false, error: { code: 'action-undeclared' } } });
  });
  test('a payload outside the schema is refused without echoing the value', () => {
    const verdict = validateAdminSurfaceMessage({ event: event({}, request({ payload: { name: 'x', token: 'SECRET-VALUE' } })), mount });
    expect(verdict).toMatchObject({ ok: false, refused: 'invalid-payload' });
    expect(JSON.stringify(verdict)).not.toContain('SECRET-VALUE');
  });
  test('an oversized payload is refused', () => {
    const verdict = validateAdminSurfaceMessage({ event: event({}, request({ payload: { name: 'x'.repeat(70_000) } })), mount });
    expect(verdict).toMatchObject({ ok: false, refused: 'invalid-payload', response: { error: { message: 'The request is too large.' } } });
  });
});

describe('server-side dispatcher', () => {
  const descriptor = parseOne({ actions: [{ name: 'save', input, result: { type: 'object', properties: { saved: { type: 'boolean' } }, required: ['saved'] } }] });
  test('an undeclared action is refused even when a handler exists for it', async () => {
    const handler = vi.fn(async () => ({ saved: true }));
    const { dispatch } = createAdminSurfaceActionDispatcher({ descriptor, handlers: { save: handler, purge: handler } });
    expect(await dispatch({ action: 'purge', payload: {}, context: {} })).toEqual({ ok: false, error: { code: 'action-undeclared', message: 'This surface did not declare that action.', retryable: false } });
    expect(handler).not.toHaveBeenCalled();
  });
  test.each(['__proto__', 'constructor', 'toString'])('prototype key %j never resolves a handler', async (action) => {
    const { dispatch } = createAdminSurfaceActionDispatcher({ descriptor: { id: 's', actions: [{ name: action, input }] }, handlers: {} });
    expect(await dispatch({ action, payload: { name: 'x' }, context: {} })).toMatchObject({ ok: false, error: { code: 'action-unavailable' } });
  });
  test('an invalid payload never reaches the handler', async () => {
    const handler = vi.fn(async () => ({ saved: true }));
    const { dispatch } = createAdminSurfaceActionDispatcher({ descriptor, handlers: { save: handler } });
    expect(await dispatch({ action: 'save', payload: { name: 42 }, context: {} })).toMatchObject({ ok: false, error: { code: 'invalid-payload', message: "The request does not match the action's input: $.name must be a string." } });
    expect(handler).not.toHaveBeenCalled();
  });
  test('a handler throw is reported to the host but never leaks to the surface', async () => {
    const heard: unknown[] = [];
    const { dispatch } = createAdminSurfaceActionDispatcher({ descriptor, handlers: { save: async () => { throw new Error('db password=hunter2'); } } }, { onHandlerError: ({ error }) => heard.push(error) });
    const outcome = await dispatch({ action: 'save', payload: { name: 'x' }, context: {} });
    expect(outcome).toEqual({ ok: false, error: { code: 'action-failed', message: 'The action failed. Try again; if it keeps failing, check the server log.', retryable: true } });
    expect(heard).toHaveLength(1);
  });
  test('an AdminSurfaceActionError carries its surface-safe code and message', async () => {
    const { dispatch } = createAdminSurfaceActionDispatcher({ descriptor, handlers: { save: async () => { throw new AdminSurfaceActionError({ code: 'reconnect-required', message: 'Reconnect the account.' }, { retryable: false }); } } });
    expect(await dispatch({ action: 'save', payload: { name: 'x' }, context: {} })).toEqual({ ok: false, error: { code: 'reconnect-required', message: 'Reconnect the account.', retryable: false } });
  });
  test('a result outside the declared result schema is refused', async () => {
    const { dispatch } = createAdminSurfaceActionDispatcher({ descriptor, handlers: { save: async () => ({ saved: true, accessToken: 'SECRET' }) } });
    expect(await dispatch({ action: 'save', payload: { name: 'x' }, context: {} })).toEqual({ ok: false, error: { code: 'invalid-result', message: 'The host returned a result this surface did not declare.', retryable: false } });
  });
});

describe('surface client trust rules', () => {
  afterEach(() => vi.useRealTimers());
  function harness() {
    const parent = { posted: [] as Array<{ message: unknown; targetOrigin: string }>, postMessage(message: unknown, targetOrigin: string) { this.posted.push({ message, targetOrigin }); } };
    let deliver: (event: AdminSurfaceIncomingMessage) => void = () => {};
    const client = createAdminSurfaceClient({ parent, listen: (handler) => { deliver = handler; return () => { deliver = () => {}; }; } }, { timeoutMs: 1000, nowMs: () => 5_000 });
    const init = (overrides: Partial<AdminSurfaceIncomingMessage> = {}, data: Record<string, unknown> = {}) => deliver({ origin: 'https://host.example.com', source: parent, data: { protocol: 'jini.admin-surface', version: 1, kind: 'init', mountId: 'nonce-1', ...data }, ...overrides });
    const respond = (overrides: Partial<AdminSurfaceIncomingMessage> = {}, data: Record<string, unknown> = {}) => deliver({ origin: 'https://host.example.com', source: parent, data: { protocol: 'jini.admin-surface', version: 1, kind: 'action-response', mountId: 'nonce-1', requestId: 'r1', ok: true, result: 'done', ...data }, ...overrides });
    return { parent, client, init, respond };
  }
  test('posts requests to the host origin learned from init, never "*"', async () => {
    const { parent, client, init, respond } = harness();
    init();
    const pending = client.call({ action: 'save', payload: { name: 'x' } });
    await Promise.resolve();
    expect(parent.posted).toEqual([{ message: { protocol: 'jini.admin-surface', version: 1, kind: 'action-request', mountId: 'nonce-1', requestId: 'r1', action: 'save', payload: { name: 'x' } }, targetOrigin: 'https://host.example.com' }]);
    respond();
    await expect(pending).resolves.toBe('done');
  });
  test('init from a window other than the parent is ignored, and a second init cannot replace the first', async () => {
    const { parent, client, init } = harness();
    init({ source: {}, origin: 'https://evil.example.com' }, { mountId: 'evil' });
    init();
    init({ origin: 'https://evil.example.com' }, { mountId: 'evil' });
    const pending = client.call({ action: 'save', payload: {} });
    await Promise.resolve();
    expect(parent.posted[0]).toMatchObject({ targetOrigin: 'https://host.example.com', message: { mountId: 'nonce-1' } });
    client.close();
    await expect(pending).rejects.toMatchObject({ code: 'closed', retryable: false });
  });
  test('responses with the wrong origin, source, mount or shape do not settle the call', async () => {
    vi.useFakeTimers();
    const { client, init, respond } = harness();
    init();
    const pending = client.call({ action: 'save', payload: {} });
    await Promise.resolve();
    respond({ origin: 'https://evil.example.com' });
    respond({ source: {} });
    respond({}, { mountId: 'nonce-2' });
    respond({}, { ok: false, error: { code: 'x' } });
    respond({}, { requestId: 'r9' });
    vi.advanceTimersByTime(1000);
    await expect(pending).rejects.toMatchObject({ name: 'AdminSurfaceCallError', code: 'timeout', retryable: true });
  });
  test('bootstrap data is withheld once expired', () => {
    const fresh = harness();
    fresh.init({}, { bootstrap: { surfaceId: 's', issuedAt: 0, expiresAt: 5_001, data: { token: 't' } } });
    expect(fresh.client.bootstrap()).toEqual({ token: 't' });
    const stale = harness();
    stale.init({}, { bootstrap: { surfaceId: 's', issuedAt: 0, expiresAt: 5_000, data: { token: 't' } } });
    expect(stale.client.bootstrap()).toBeUndefined();
  });
});

describe('bootstrap and mount', () => {
  test('bootstrap headers forbid caching', () => {
    expect(adminSurfaceBootstrapHeaders()).toEqual({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  });
  test('the bootstrap expires and its lifetime is capped at five minutes', () => {
    const bootstrap = createAdminSurfaceBootstrap({ surfaceId: 's', data: {}, nowMs: 1000 });
    expect(bootstrap).toEqual({ surfaceId: 's', issuedAt: 1000, expiresAt: 61_000, data: {} });
    expect(isAdminSurfaceBootstrapCurrent({ bootstrap, nowMs: 60_999 })).toBe(true);
    expect(isAdminSurfaceBootstrapCurrent({ bootstrap, nowMs: 61_000 })).toBe(false);
    expect(() => createAdminSurfaceBootstrap({ surfaceId: 's', data: {}, nowMs: 0 }, { ttlMs: 300_001 })).toThrow('Admin surface bootstrap TTL must be between 1 and 300000 ms; pass a shorter ttlMs.');
    expect(() => createAdminSurfaceBootstrap({ surfaceId: 's', data: {}, nowMs: 0 }, { ttlMs: 0 })).toThrow('Admin surface bootstrap TTL must be between 1 and 300000 ms; pass a shorter ttlMs.');
  });
  test('each mount gets a fresh 128-bit nonce and expects the opaque "null" origin', () => {
    const a = createAdminSurfaceMount({ surfaceId: 's' });
    const b = createAdminSurfaceMount({ surfaceId: 's' });
    expect(a.mountId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.mountId).not.toBe(b.mountId);
    expect(a.expectedOrigin).toBe('null');
  });
});
