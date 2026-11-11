/**
 * @file Negative tests for the surface-side mirror of the host's message gate (`surface-client.ts`):
 * each field of an incoming response / theme envelope is broken ONE AT A TIME against an otherwise
 * valid message, so a weakened check makes a test fail. Also the theme token grammar and value
 * bounds, the token cap, and height de-duplication. Closes Stryker run-2 survivors at
 * surface-client.ts:21, 97-112, 149, 176-190, 207. Parent window, listener, root and size are fakes.
 */
import { describe, expect, test } from 'vitest';
import { createAdminSurfaceClient, type AdminSurfaceIncomingMessage, type AdminSurfaceParentPort } from '../surface-client.js';

const HOST = 'https://host.example.com';
const BASE = { protocol: 'jini.admin-surface', version: 1 } as const;

function harness() {
  const posted: Array<{ message: Record<string, unknown>; targetOrigin: string }> = [];
  const parent: AdminSurfaceParentPort = { postMessage: (message, targetOrigin) => { posted.push({ message: message as Record<string, unknown>, targetOrigin }); } };
  let deliver: (event: AdminSurfaceIncomingMessage) => void = () => undefined;
  let reportHeight: (height: number) => void = () => undefined;
  const properties = new Map<string, string>();
  const root = { style: { setProperty: (name: string, value: string) => { properties.set(name, value); }, removeProperty: (name: string) => { properties.delete(name); } }, setAttribute: () => undefined };
  const client = createAdminSurfaceClient(
    { parent, listen: (handler) => { deliver = handler; return () => undefined; } },
    { themeRoot: root, size: (onHeight) => { reportHeight = onHeight; return () => undefined; }, timeoutMs: 60_000 },
  );
  const send = (data: unknown, from: Partial<AdminSurfaceIncomingMessage> = {}) => deliver({ origin: HOST, source: parent, data, ...from });
  send({ ...BASE, kind: 'init', mountId: 'm-1' });
  return { posted, client, send, properties, height: (value: number) => reportHeight(value) };
}

/** Starts one call and reports whether it is still pending after `deliver` runs. */
async function settledAfter(deliver: (h: ReturnType<typeof harness>) => void) {
  const h = harness();
  let settled: unknown = 'pending';
  const call = h.client.call({ action: 'save', payload: {} }).then((value) => { settled = { value }; }, (error: unknown) => { settled = { error }; });
  await Promise.resolve(); await Promise.resolve();
  deliver(h);
  await Promise.resolve(); await Promise.resolve();
  const result = settled;
  h.client.close();
  await call;
  return result;
}

const response = { ...BASE, kind: 'action-response', mountId: 'm-1', requestId: 'r1', ok: true, result: 'done' };

describe('action responses: each envelope field broken alone is ignored', () => {
  test('the valid baseline resolves the call', async () => {
    expect(await settledAfter((h) => h.send(response))).toEqual({ value: 'done' });
  });

  test.each<[string, Record<string, unknown>]>([
    ['wrong protocol', { protocol: 'other' }], ['wrong version', { version: 2 }], ['wrong kind', { kind: 'action-request' }],
    ['other mount', { mountId: 'm-2' }], ['non-string requestId', { requestId: 1 }], ['unknown requestId', { requestId: 'r9' }],
    ['ok true without result', { result: undefined }], ['ok missing', { ok: undefined }], ['ok truthy non-boolean', { ok: 1 }],
  ])('%s', async (_name, override) => {
    const message: Record<string, unknown> = { ...response, ...override };
    for (const key of Object.keys(override)) if (override[key] === undefined) delete message[key];
    expect(await settledAfter((h) => h.send(message))).toBe('pending');
  });

  test.each([[null], ['action-response'], [3]])('non-object data %j is ignored', async (data) => {
    expect(await settledAfter((h) => h.send(data))).toBe('pending');
  });

  test('a response from another origin or another window is ignored', async () => {
    expect(await settledAfter((h) => h.send(response, { origin: 'https://evil.example' }))).toBe('pending');
    expect(await settledAfter((h) => h.send(response, { source: {} }))).toBe('pending');
  });
});

describe('failure responses: the error must have code, message and retryable', () => {
  const failure = (error: unknown) => ({ ...BASE, kind: 'action-response', mountId: 'm-1', requestId: 'r1', ok: false, error });
  const good = { code: 'nope', message: 'No.', retryable: false };

  test('a well-formed failure rejects with that code', async () => {
    expect(await settledAfter((h) => h.send(failure(good)))).toEqual({ error: expect.objectContaining({ code: 'nope', message: 'No.', retryable: false }) });
  });

  test.each<[string, unknown]>([
    ['missing code', { message: 'No.', retryable: false }], ['missing message', { code: 'nope', retryable: false }],
    ['missing retryable', { code: 'nope', message: 'No.' }], ['retryable as string', { ...good, retryable: 'false' }],
    ['code as number', { ...good, code: 1 }], ['null error', null], ['string error', 'nope'],
  ])('%s is ignored', async (_name, error) => {
    expect(await settledAfter((h) => h.send(failure(error)))).toBe('pending');
  });
});

describe('theme messages', () => {
  const theme = (value: unknown, mountId = 'm-1') => ({ ...BASE, kind: 'theme', mountId, theme: value });

  test.each<[string, boolean]>([
    ['--jini-a', true], ['--jini-a-9', true], [`--jini-${'a'.repeat(60)}`, true],
    [`--jini-${'a'.repeat(61)}`, false], ['--jini-', false], ['x--jini-a', false], ['--jini-a\n', false], ['--jini-a!', false], ['--jini-A', false], ['--other-a', false],
  ])('token name %j accepted: %s', (name, accepted) => {
    const h = harness();
    h.send(theme({ scheme: 'light', tokens: { [name]: 'red' } }));
    expect(h.client.theme()).toEqual({ scheme: 'light', tokens: accepted ? { [name]: 'red' } : {} });
  });

  test.each<[string, unknown, boolean]>([
    ['one character', 'r', true], ['200 characters', 'x'.repeat(200), true], ['201 characters', 'x'.repeat(201), false],
    ['empty', '', false], ['a number', 4, false], ['url()', 'url(x)', false], ['a declaration breakout', 'red;x:y', false],
  ])('token value %s accepted: %s', (_name, value, accepted) => {
    const h = harness();
    h.send(theme({ scheme: 'dark', tokens: { '--jini-a': value } }));
    expect(h.client.theme()).toEqual({ scheme: 'dark', tokens: accepted ? { '--jini-a': value } : {} });
  });

  test('only the first 100 tokens are read', () => {
    const h = harness();
    const tokens = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`--jini-t${i}`, 'red']));
    h.send(theme({ scheme: 'light', tokens }));
    expect(Object.keys(h.client.theme()!.tokens)).toHaveLength(100);
    expect(h.client.theme()!.tokens['--jini-t100']).toBeUndefined();
  });

  test.each<[string, unknown]>([
    ['scheme neither light nor dark', { scheme: 'sepia', tokens: {} }], ['missing scheme', { tokens: {} }],
    ['null tokens', { scheme: 'light', tokens: null }], ['string tokens', { scheme: 'light', tokens: 'x' }],
    ['null theme', null], ['string theme', 'light'],
  ])('%s is not applied', (_name, value) => {
    const h = harness();
    h.send(theme({ scheme: 'dark', tokens: { '--jini-a': 'red' } }));
    h.send(theme(value));
    expect(h.client.theme()).toEqual({ scheme: 'dark', tokens: { '--jini-a': 'red' } });
  });

  test('a theme from another origin or another mount is not applied', () => {
    const h = harness();
    h.send(theme({ scheme: 'dark', tokens: {} }), { origin: 'https://evil.example' });
    h.send(theme({ scheme: 'dark', tokens: {} }, 'm-2'));
    expect(h.client.theme()).toBeUndefined();
  });

  test('a later theme removes only the tokens it leaves out', () => {
    const h = harness();
    h.send(theme({ scheme: 'dark', tokens: { '--jini-a': 'red', '--jini-b': 'blue' } }));
    h.send(theme({ scheme: 'dark', tokens: { '--jini-b': 'green' } }));
    expect([...h.properties.entries()]).toEqual([['--jini-b', 'green'], ['color-scheme', 'dark']]);
  });
});

describe('height reports', () => {
  const heights = (h: ReturnType<typeof harness>) => h.posted.filter((entry) => entry.message.kind === 'resize').map((entry) => entry.message.height);

  test('the first report is sent whatever its value (including 1 and 0); repeats and non-finite heights are not', () => {
    const h = harness();
    h.height(1); h.height(1); h.height(0); h.height(Number.NaN); h.height(Number.POSITIVE_INFINITY); h.height(2);
    expect(heights(h)).toEqual([1, 0, 2]);
    expect(h.posted[0]).toEqual({ message: { ...BASE, kind: 'resize', mountId: 'm-1', height: 1 }, targetOrigin: HOST });
  });
});
