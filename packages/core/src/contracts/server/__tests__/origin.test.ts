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
});
