import { describe, expect, it } from 'vitest';
import { guardSameOrigin, type OriginContext } from '../origin.js';

const origin: OriginContext = { resolvedPortRef: { current: 7000 }, env: {}, allowedOriginsEnvVar: 'A', webPortEnvVar: 'W', bindHostEnvVar: 'B' };

describe('guardSameOrigin', () => {
  it('accepts a same-origin loopback request', () => {
    expect(guardSameOrigin({ req: { headers: { host: '127.0.0.1:7000', origin: 'http://127.0.0.1:7000' } }, origin }).ok).toBe(true);
  });
  it('refuses a foreign origin with the fixed message', () => {
    const verdict = guardSameOrigin({ req: { headers: { host: '127.0.0.1:7000', origin: 'http://evil.example' } }, origin });
    expect(verdict.ok ? undefined : verdict.error).toEqual({ code: 'FORBIDDEN', message: 'cross-origin request rejected' });
  });
  // The guard reads the context's own env (the one a host injected), not the real process env: the
  // middleware is handed the same env, so both halves of one decision must agree.
  it("reads the context's own env: an injected allow-list admits an origin the empty env refuses", () => {
    const req = { headers: { host: 'proxy.internal:7000', origin: 'https://ok.example' } };
    expect(guardSameOrigin({ req, origin }).ok).toBe(false);
    expect(guardSameOrigin({ req, origin: { ...origin, env: { A: 'https://ok.example' } } }).ok).toBe(true);
  });
  it("tracks the live env reference the host injected: a later mutation changes the verdict", () => {
    const env: Record<string, string | undefined> = {};
    const req = { headers: { host: 'proxy.internal:7000', origin: 'https://ok.example' } };
    const live: OriginContext = { ...origin, env };
    expect(guardSameOrigin({ req, origin: live }).ok).toBe(false);
    env.A = 'https://ok.example';
    expect(guardSameOrigin({ req, origin: live }).ok).toBe(true);
  });
});
