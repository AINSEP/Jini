import { describe, expect, it } from 'vitest';
import { createLocalSameOriginPolicy, guardSameOrigin, type OriginContext } from '../origin.js';
import { allowAllOrigins, createRecordingOriginPolicy, createTestRouteHost, denyAllOrigins } from '../testing.js';

const config = { allowedOriginsEnvVar: 'A', webPortEnvVar: 'W', bindHostEnvVar: 'B' };
const localOrigin = (env: Record<string, string | undefined> = {}, ref = { current: 7000 }): OriginContext => ({
  originPolicy: createLocalSameOriginPolicy({ port: () => ref.current, env, config }),
});

describe('guardSameOrigin', () => {
  it('accepts a same-origin loopback request', () => {
    expect(guardSameOrigin({ req: { headers: { host: '127.0.0.1:7000', origin: 'http://127.0.0.1:7000' } }, origin: localOrigin() }).ok).toBe(true);
  });
  it('refuses a foreign origin with the fixed message', () => {
    const verdict = guardSameOrigin({ req: { headers: { host: '127.0.0.1:7000', origin: 'http://evil.example' } }, origin: localOrigin() });
    expect(verdict.ok ? undefined : verdict.error).toEqual({ code: 'FORBIDDEN', message: 'cross-origin request rejected' });
  });
  it("reads the policy's own env: an injected allow-list admits an origin the empty env refuses", () => {
    const req = { headers: { host: 'proxy.internal:7000', origin: 'https://ok.example' } };
    expect(guardSameOrigin({ req, origin: localOrigin() }).ok).toBe(false);
    expect(guardSameOrigin({ req, origin: localOrigin({ A: 'https://ok.example' }) }).ok).toBe(true);
  });
  it('tracks the live env reference the host injected: a later mutation changes the verdict', () => {
    const env: Record<string, string | undefined> = {};
    const req = { headers: { host: 'proxy.internal:7000', origin: 'https://ok.example' } };
    const live = localOrigin(env);
    expect(guardSameOrigin({ req, origin: live }).ok).toBe(false);
    env.A = 'https://ok.example';
    expect(guardSameOrigin({ req, origin: live }).ok).toBe(true);
  });
  it('reads the resolved port on every call: the same request flips verdict when the ref is bumped', () => {
    const ref = { current: 7000 };
    const live = localOrigin({}, ref);
    const req = { headers: { host: '127.0.0.1:7456', origin: 'http://127.0.0.1:7456' } };
    expect(guardSameOrigin({ req, origin: live }).ok).toBe(false);
    ref.current = 7456;
    expect(guardSameOrigin({ req, origin: live }).ok).toBe(true);
  });
  it('refuses a foreign origin even on a loopback Host', () => {
    expect(guardSameOrigin({ req: { headers: { host: '127.0.0.1:7000', origin: 'https://evil.example' } }, origin: localOrigin() }).ok).toBe(false);
  });
  it('treats a header-less loopback request as same-origin and a header-less foreign Host as not', () => {
    expect(guardSameOrigin({ req: { headers: { host: '127.0.0.1:7000' } }, origin: localOrigin() }).ok).toBe(true);
    expect(guardSameOrigin({ req: { headers: { host: 'evil.example' } }, origin: localOrigin() }).ok).toBe(false);
  });
  it('lets the policy decide: a thrown policy error reaches the caller instead of being read as a verdict', () => {
    const origin: OriginContext = { originPolicy: { isSameOrigin: () => { throw new Error('boom'); } } };
    expect(() => guardSameOrigin({ req: { headers: {} }, origin })).toThrow('boom');
  });
});

describe('createLocalSameOriginPolicy', () => {
  it('reaches the logger option: a malformed allow-list entry is reported', () => {
    const warnings: unknown[][] = [];
    const policy = createLocalSameOriginPolicy({ port: () => 7000, env: { A: 'not-an-origin' }, config }, { logger: { warn: (...args: unknown[]) => { warnings.push(args); } } });
    policy.isSameOrigin({ req: { headers: { host: '127.0.0.1:7000' } } });
    expect(JSON.stringify(warnings)).toContain('malformed A entry');
  });
});

describe('origin testing helpers', () => {
  it('allowAllOrigins passes and denyAllOrigins refuses, both with core\'s real FORBIDDEN answer', () => {
    const req = { headers: {} };
    expect(guardSameOrigin({ req, origin: createTestRouteHost() }).ok).toBe(true);
    expect(guardSameOrigin({ req, origin: createTestRouteHost({}, { originPolicy: allowAllOrigins }) }).ok).toBe(true);
    const refused = guardSameOrigin({ req, origin: createTestRouteHost({}, { originPolicy: denyAllOrigins }) });
    expect(refused.ok ? undefined : refused.error.code).toBe('FORBIDDEN');
  });
  it('the recording policy records each request it was asked about and can be flipped mid-test', () => {
    const recording = createRecordingOriginPolicy();
    const origin = createTestRouteHost({}, { originPolicy: recording });
    const req = { headers: { host: 'h' } };
    expect(guardSameOrigin({ req, origin }).ok).toBe(true);
    recording.set({ allow: false });
    expect(guardSameOrigin({ req, origin }).ok).toBe(false);
    expect(recording.calls).toEqual([req, req]);
    expect(createRecordingOriginPolicy({}, { allow: false }).isSameOrigin({ req })).toBe(false);
  });
  it('createTestRouteHost carries the internal-error sink only when one is passed', () => {
    const sink = () => undefined;
    expect(createTestRouteHost().onInternalError).toBeUndefined();
    expect(createTestRouteHost({}, { onInternalError: sink }).onInternalError).toBe(sink);
  });
  it('the shared policies are frozen so one test cannot flip them for another', () => {
    expect([Object.isFrozen(allowAllOrigins), Object.isFrozen(denyAllOrigins)]).toEqual([true, true]);
  });
});
