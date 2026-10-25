import type { Express } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerApiBearerAuthMiddleware, registerApiOriginGuardMiddleware, requireStrictBearerToken } from '../api-security-middleware.js';
import { isLoopbackPeerAddress } from '../local-daemon-request.js';

/** Negative tables for the loopback trust decisions (L9 §8.1, TEST-ANTIPATTERNS AP4/AP7):
 *  look-alike peers and origins must be refused, and each refusal asserts the exact body. */
describe('isLoopbackPeerAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '127.0.0.2', '::1', '0:0:0:0:0:0:0:1', '[::1]', '::ffff:127.0.0.1', '::FFFF:127.0.0.9',
    ' 127.0.0.1 ', '[::1', '::1]',
  ])('trusts %j', (address) => {
    expect(isLoopbackPeerAddress({ address })).toBe(true);
  });
  it.each([
    '10.0.0.127', '1.127.0.0', '128.0.0.1', '126.255.255.255', '127.0.0.1.evil.com', '127.0.0.1x', 'x127.0.0.1', '127.1',
    '::2', '::', '::ffff:10.0.0.1', '::ffff:', 'localhost', '', '   ', '[]', '12[7.0.0.1', '::]1', '[[::1]]', '0.0.0.0',
  ])('refuses look-alike %j', (address) => {
    expect(isLoopbackPeerAddress({ address })).toBe(false);
  });
  it.each([undefined, null, 127, ['127.0.0.1'], { address: '127.0.0.1' }])('refuses non-string %j', (address) => {
    expect(isLoopbackPeerAddress({ address })).toBe(false);
  });
});

function gate(register: (app: Express) => void) {
  const handlers: Array<(req: any, res: any, next: any) => void> = [];
  register({ use: (_path: string, handler: (req: any, res: any, next: any) => void) => handlers.push(handler) } as unknown as Express);
  return handlers[0]!;
}
function call(handler: (req: any, res: any, next: any) => void, req: { method?: string; path?: string; origin?: string; host?: string; remoteAddress?: string; authorization?: string; headers?: Record<string, string> }) {
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  if (req.origin !== undefined) headers.origin = req.origin;
  if (req.host !== undefined) headers.host = req.host;
  if (req.authorization !== undefined) headers.authorization = req.authorization;
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  handler({ method: req.method ?? 'GET', path: req.path ?? '/x', headers, socket: { remoteAddress: req.remoteAddress }, get: (name: string) => headers[name.toLowerCase()] }, res, next);
  return { res, next };
}

describe('origin guard portless-loopback GET fallback is anchored', () => {
  const handler = () => gate((app) => registerApiOriginGuardMiddleware({ app, deps: { allowedOriginsEnvVar: 'A', webPortEnvVar: 'W', bindHostEnvVar: 'B', host: '127.0.0.1', getResolvedPort: () => 7456, env: {} } }));
  it.each(['http://127.0.0.1', 'https://localhost', 'http://[::1]'])('GET from portless %s passes', (origin) => {
    const { next, res } = call(handler(), { origin, host: 'example.test' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
  it.each([
    'http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'evil.http://localhost', 'xhttp://127.0.0.1', 'http://127.0.0.1/', 'http://localhost/path',
    'ftp://localhost', 'http://localhostx', 'http://127.0.0.10', 'http://[::1]x', 'http://LOCALHOST',
  ])('GET from look-alike %s is refused 403', (origin) => {
    const { next, res } = call(handler(), { origin, host: 'example.test' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cross-origin requests are not allowed' });
  });
  it('POST from a portless loopback origin is refused (fallback is GET-only)', () => {
    const { next, res } = call(handler(), { method: 'POST', origin: 'http://localhost', host: 'example.test' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('bearer gate loopback exemption', () => {
  const handler = () => gate((app) => registerApiBearerAuthMiddleware({ app, env: { T: 'secret' }, tokenConfig: { tokenEnvVar: 'T', disableEnvVar: 'D' } }));
  const denied = { error: { code: 'API_TOKEN_REQUIRED', message: 'Authorization: Bearer <T> required' } };
  it.each(['10.0.0.127', '127.0.0.1.evil.com', '::ffff:10.0.0.1', undefined])('peer %j without a token gets 401 API_TOKEN_REQUIRED', (remoteAddress) => {
    const { next, res } = call(handler(), { remoteAddress });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(denied);
  });
  it('a loopback peer passes without a token, but not once a forwarding header is present', () => {
    expect(call(handler(), { remoteAddress: '127.0.0.1' }).next).toHaveBeenCalledOnce();
    const proxied = call(handler(), { remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(proxied.next).not.toHaveBeenCalled();
    expect(proxied.res.json).toHaveBeenCalledWith(denied);
  });
  it('trustLoopbackPeers:false removes the exemption', () => {
    const strict = gate((app) => registerApiBearerAuthMiddleware({ app, env: { T: 'secret' }, tokenConfig: { tokenEnvVar: 'T', disableEnvVar: 'D' } }, { trustLoopbackPeers: false }));
    const { next, res } = call(strict, { remoteAddress: '127.0.0.1' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('wrong token is 401 and the right one passes from a remote peer', () => {
    expect(call(handler(), { remoteAddress: '10.0.0.1', authorization: 'Bearer nope' }).res.status).toHaveBeenCalledWith(401);
    expect(call(handler(), { remoteAddress: '10.0.0.1', authorization: 'Bearer secret' }).next).toHaveBeenCalledOnce();
  });
});

describe('requireStrictBearerToken', () => {
  const run = (middleware: ReturnType<typeof requireStrictBearerToken>, req: { path?: string; authorization?: string; remoteAddress?: string }) =>
    call((r: any, s: any, n: any) => middleware(r, s, n), req);
  it('has no default exemptions and no loopback exemption', () => {
    const middleware = requireStrictBearerToken({ tokenEnvVar: 'T', env: { T: 'k' } });
    const { next, res } = run(middleware, { path: '/health', remoteAddress: '127.0.0.1' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'API_TOKEN_REQUIRED', message: 'Authorization: Bearer <T> required' } });
  });
  it('exempt paths match exactly, never by prefix', () => {
    const middleware = requireStrictBearerToken({ tokenEnvVar: 'T', env: { T: 'k' } }, { exemptPaths: ['/open'] });
    expect(run(middleware, { path: '/open' }).next).toHaveBeenCalledOnce();
    expect(run(middleware, { path: '/open/x' }).res.status).toHaveBeenCalledWith(401);
    expect(run(middleware, { path: '/ope' }).res.status).toHaveBeenCalledWith(401);
  });
  it('unset or empty token env is 503 API_TOKEN_NOT_CONFIGURED, even with a bearer', () => {
    for (const env of [{}, { T: '' }]) {
      const { next, res } = run(requireStrictBearerToken({ tokenEnvVar: 'T', env }), { authorization: 'Bearer ' });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ error: { code: 'API_TOKEN_NOT_CONFIGURED', message: 'T is not set — this daemon refuses to serve unauthenticated callers' } });
    }
  });
});
