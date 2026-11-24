import { describe, expect, it } from 'vitest';
import { isRouteReply } from '@jini-ai/core/contracts/server';
import {
  browserTelemetryRoute, MAX_TELEMETRY_BODY_BYTES, parseBrowserTelemetry, scrubTelemetryText, toRouteTemplate,
  type BrowserTelemetryRouteDeps,
} from '../browser-telemetry.js';

function fakeDeps({ kind = 'session', allowed = true }: { kind?: string; allowed?: boolean } = {}) {
  const captured: unknown[] = [];
  const reported: unknown[] = [];
  const keys: string[] = [];
  const deps: BrowserTelemetryRouteDeps = {
    tracker: { capture: (input, options) => { captured.push({ ...input, ...options }); }, error: (input, options) => { reported.push({ ...input, ...options }); } },
    limiter: { check: async ({ key }) => { keys.push(key); return { allowed, retryAfterSeconds: 7 }; } },
    credentialKind: () => kind,
  };
  return { deps, captured, reported, keys };
}

async function post(body: unknown, { contentLength, ...options }: { kind?: string; allowed?: boolean; contentLength?: number } = {}) {
  const fake = fakeDeps(options);
  const headers = contentLength === undefined ? {} : { 'content-length': String(contentLength) };
  const parsed = browserTelemetryRoute.parse({ body, query: {}, params: {}, headers });
  if (!parsed.ok) throw new Error('parse must be total');
  const result = await browserTelemetryRoute.handle({ input: parsed.value, deps: fake.deps, context: { id: 'user-1' } }, {});
  if (!result.ok) throw new Error('handle answers every refusal as a reply');
  return { ...fake, value: result.value };
}

describe('browserTelemetryRoute', () => {
  it('keeps the method, byte-identical path and a bodiless 204 success', () => {
    expect(browserTelemetryRoute.method).toBe('post');
    expect(browserTelemetryRoute.path).toBe('/api/admin/v1/telemetry');
    expect(browserTelemetryRoute.successStatus).toBe(204);
  });

  it('forwards a page view as admin_pageview with only the route template and answers no value', async () => {
    const out = await post({ type: 'pageview', route: '/admin/posts/42?q=draft' });
    expect(out.value).toBeUndefined();
    expect(out.captured).toEqual([{ name: 'admin_pageview', userId: 'user-1', properties: { route: '/admin/posts/:id' } }]);
    expect(out.keys).toEqual(['user-1']);
  });

  it('refuses a machine credential with 403 before the budget or the body is read', async () => {
    const out = await post({ type: 'pageview', route: '/admin' }, { kind: 'api_key' });
    expect(isRouteReply(out.value) && out.value).toMatchObject({ status: 403, body: { error: 'browser telemetry requires a signed-in session', code: 'FORBIDDEN' } });
    expect(out.keys).toEqual([]);
  });

  it('refuses a declared oversize body with 413 before the budget', async () => {
    const out = await post({ type: 'pageview', route: '/admin' }, { contentLength: MAX_TELEMETRY_BODY_BYTES + 1 });
    expect(isRouteReply(out.value) && out.value).toMatchObject({ status: 413, body: { error: 'telemetry body is too large', code: 'PAYLOAD_TOO_LARGE' } });
    expect(out.keys).toEqual([]);
  });

  it('answers 429 with Retry-After when the budget is spent, even for a malformed body', async () => {
    const out = await post({ type: 'nope' }, { allowed: false });
    expect(isRouteReply(out.value) && out.value).toMatchObject({ status: 429, headers: { 'Retry-After': '7' }, body: { code: 'RATE_LIMIT_EXCEEDED' } });
    expect(out.captured).toEqual([]);
  });

  it('answers a validation failure after the budget with its own status and code', async () => {
    const out = await post({ type: 'pageview', route: '/elsewhere' });
    expect(isRouteReply(out.value) && out.value).toMatchObject({ status: 400, body: { error: 'route must be an admin path', code: 'INVALID_INPUT' } });
    expect(out.keys).toEqual(['user-1']);
  });

  it('reports a scrubbed browser error to the tracker', async () => {
    const out = await post({ type: 'error', message: 'boom https://h.test/a?token=x', stack: '', route: '/admin' });
    expect(out.reported).toHaveLength(1);
    expect((out.reported[0] as { error: Error }).error.message).toBe('boom https://h.test/a');
  });

  it('keeps the pure helpers', () => {
    expect(toRouteTemplate({ raw: '/admin/posts/42#x' })).toBe('/admin/posts/:id');
    expect(scrubTelemetryText({ text: 'see https://h.test/p?q=1' })).toBe('see https://h.test/p');
    expect(parseBrowserTelemetry({ body: [] })).toEqual({ ok: false, status: 400, error: 'body must be an object' });
  });
});
