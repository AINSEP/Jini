import { describe, expect, it } from 'vitest';
import { err, ok } from '../result.js';
import { ClientFacingError, jsonResponse, jsonRoute, type JsonRouteSpec, type ReportRouteInternalError, type RouteHostContext } from '../json-route.js';
import { createInMemoryServer } from '../testing.js';
import { createLocalSameOriginPolicy } from '../origin.js';

describe('jsonResponse', () => {
  it('uses Express res.json content type and extra headers', async () => {
    const res = jsonResponse({ status: 404, body: { a: 1 } }, { headers: { 'x-y': 'z' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-y')).toBe('z');
    expect(await res.json()).toEqual({ a: 1 });
  });
});


const post = (body: unknown, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}) =>
  new Request('http://local/r', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...init.headers }, ...(init.signal ? { signal: init.signal } : {}) });

const reports: unknown[] = [];
const optionals: unknown[] = [];
const reportInternalError: ReportRouteInternalError = ({ report, message }, optional) => {
  reports.push(report);
  optionals.push(optional);
  return { code: 'INTERNAL_ERROR', message, requestId: 'req-1' };
};
const host: RouteHostContext = {
  originPolicy: createLocalSameOriginPolicy({ port: () => 7000, env: {}, config: { allowedOriginsEnvVar: 'A', webPortEnvVar: 'W', bindHostEnvVar: 'B' } }),
};

function mount(spec: Partial<JsonRouteSpec<{ n: number }, { n: number }, null>> = {}, withHost = true) {
  const app = createInMemoryServer();
  app.server.route(jsonRoute({ deps: null, reportInternalError, spec: {
    method: 'post', path: '/r', parse: ({ body }) => ok({ value: body as { n: number } }), handle: ({ input }) => ok({ value: input }), ...spec,
  } }, withHost ? { host } : {}));
  return app;
}

describe('jsonRoute', () => {
  it('answers with successStatus', async () => {
    const response = await mount({ successStatus: 201 }).fetch(post({ n: 1 }));
    expect([response.status, await response.json()]).toEqual([201, { n: 1 }]);
  });
  it('answers a null-body success status (204, 205, 304) without a body', async () => {
    for (const successStatus of [204, 205, 304]) {
      const response = await mount({ successStatus }).fetch(post({ n: 1 }));
      expect([response.status, response.body, response.headers.get('content-type')]).toEqual([successStatus, null, null]);
    }
  });
  it('maps a parse failure to its status envelope', async () => {
    const response = await mount({ parse: () => err({ error: { code: 'BAD_REQUEST', message: 'no' } }) }).fetch(post({}));
    expect([response.status, await response.json()]).toEqual([400, { error: { code: 'BAD_REQUEST', message: 'no' } }]);
  });
  it('maps an err from handle to its status', async () => {
    const response = await mount({ handle: () => err({ error: { code: 'NOT_FOUND', message: 'gone' } }) }).fetch(post({}));
    expect(response.status).toBe(404);
  });
  it('sends a ClientFacingError verbatim and never reaches the sink', async () => {
    reports.length = 0;
    const app = mount({ handle: () => { throw new ClientFacingError({ apiError: { code: 'CONFLICT', message: 'taken' } }); } });
    const response = await app.fetch(post({}));
    expect([response.status, reports.length]).toEqual([409, 0]);
  });
  it('answers a plain throw with 500 and a request id, hiding the message', async () => {
    reports.length = 0;
    const response = await mount({ handle: () => { throw new Error('secret db path'); } }).fetch(post({}));
    const text = await response.text();
    expect([response.status, text.includes('secret'), text.includes('req-1'), reports.length]).toEqual([500, false, true, 1]);
  });
  it('reports a plain throw with no host context at all, still hiding the message', async () => {
    reports.length = 0; optionals.length = 0;
    const response = await mount({ handle: () => { throw new Error('secret path /etc/x'); } }, false).fetch(post({}));
    const text = await response.text();
    expect([response.status, (JSON.parse(text) as { error: { requestId: string } }).error.requestId, text.includes('secret path'), reports.length]).toEqual([500, 'req-1', false, 1]);
    expect(reports[0]).toMatchObject({ method: 'post', path: '/r', error: expect.objectContaining({ message: 'secret path /etc/x' }) });
  });
  it('passes the host sink to the reporter, or undefined when the host has none', async () => {
    reports.length = 0; optionals.length = 0;
    await mount({ handle: () => { throw new Error('x'); } }).fetch(post({}));
    expect(optionals[0]).toEqual({ onInternalError: undefined });
    const onInternalError = () => undefined;
    const app = createInMemoryServer();
    app.server.route(jsonRoute({ deps: null, reportInternalError, spec: { method: 'post', path: '/r', parse: ({ body }) => ok({ value: body }), handle: () => { throw new Error('y'); } } }, { host: { ...host, onInternalError } }));
    await app.fetch(post({}));
    expect(optionals[1]).toEqual({ onInternalError });
  });
  it('lets ports.onError own the answer', async () => {
    const app = mount({ handle: () => { throw new Error('x'); }, ports: { onError: () => new Response('mine', { status: 418 }) } });
    expect((await app.fetch(post({}))).status).toBe(418);
  });
  it('refuses a cross-origin request and needs a host context to check one', async () => {
    const refused = await mount({ requireSameOrigin: true }).fetch(post({}, { headers: { origin: 'http://evil.example', host: 'local' } }));
    expect([refused.status, (await refused.json() as { error: { message: string } }).error.message]).toEqual([403, 'cross-origin request rejected']);
    // Since the SEC-005 reporter became a route argument, the missing host is reported and answered 500, never served.
    reports.length = 0;
    const hostless = await mount({ requireSameOrigin: true }, false).fetch(post({}));
    expect([hostless.status, reports.length]).toEqual([500, 1]);
    expect(reports[0]).toMatchObject({ error: expect.objectContaining({ message: 'same-origin adapter context is required' }) });
  });
  it('does not serialize a result once the request was aborted', async () => {
    const controller = new AbortController();
    const response = await mount({ handle: () => { controller.abort(); return ok({ value: { n: 1 } }); } }).fetch(post({}, { signal: controller.signal }));
    expect(response.status).toBe(499);
  });
  it('reads no body for GET and enforces maxBodyBytes', async () => {
    const app = mount({ method: 'get', parse: ({ body }) => ok({ value: body as { n: number } }) });
    expect(await (await app.fetch(new Request('http://local/r'))).json()).toEqual({});
    const small = mount({ maxBodyBytes: 1024 });
    const big = await small.fetch(new Request('http://local/r', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(1030) }) }));
    expect(big.status).toBe(413);
  });
});
