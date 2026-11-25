import { describe, expect, it } from 'vitest';
import { IdentityValidationError, OwnerRequiredError } from '../../../core/types.js';
import type { OwnerMfaDeps } from '../../../server/mfa/ports.js';
import {
  ownerMfaConfirmRoute, ownerMfaEnrollRoute, ownerMfaRemoveRoute, ownerMfaStatusRoute,
  type OwnerMfaRouteDeps,
} from '../mfa-routes.js';

type Fixture = { caller?: string | null; kind?: string; allowed?: boolean; json?: boolean; enrolled?: boolean; store?: boolean };

function fixture(options: Fixture = {}) {
  const calls: string[] = [];
  const caller = options.caller === undefined ? 'owner' : options.caller;
  const mfaDeps = { marker: 'mfa' } as unknown as OwnerMfaDeps;
  const deps: OwnerMfaRouteDeps = {
    workspaceId: 'site',
    ownerPrincipalId: Promise.resolve('owner'),
    get mfaStore() {
      return options.store === false ? null : { factor: async () => { calls.push('factor'); return options.enrolled ? { sealedSecret: 'never-return-this', lastStep: 0, workspaceId: 'site', principalId: 'owner' } : null; } };
    },
    issuer: 'Site',
    authenticate: async () => { calls.push('authenticate'); return caller ? { principal: { id: caller }, kind: options.kind ?? 'session' } : null; },
    isJsonRequest: () => options.json ?? true,
    siteOrigin: () => 'https://site.test',
    checkRateLimit: async () => { calls.push('rate'); return { allowed: options.allowed ?? true, retryAfterSeconds: 60 }; },
    ownerMfaDeps: async () => { calls.push('mfaDeps'); return mfaDeps; },
    findUserByPrincipalId: async () => ({ username: 'ada' }),
    services: {
      beginOwnerEnrollment: async (args) => { calls.push(`begin:${JSON.stringify(args.input)}`); return { pendingToken: 'p', otpauthUrl: 'otpauth://x' } as never; },
      confirmOwnerEnrollment: async (args) => { calls.push(`confirm:${args.input.pendingToken}:${args.input.code}`); if (args.input.code === 'bad') throw new IdentityValidationError({ message: 'Code is not valid.' }); },
      removeOwnerFactor: async () => { calls.push('remove'); throw new Error('database password=hunter2'); },
    },
  };
  return { deps, calls };
}

async function call(route: typeof ownerMfaEnrollRoute, deps: OwnerMfaRouteDeps, { headers = { origin: 'https://site.test' } as Record<string, string>, body = {} as unknown } = {}) {
  const raw = { params: {}, query: {}, body, headers } as never;
  const response = await route.handle({ raw, deps, context: undefined, authorize: (async () => undefined) as never }, { signal: new AbortController().signal });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
}

describe('owner MFA routes', () => {
  it('declares the four endpoints, non-cacheable, with origin headers opted in', () => {
    expect([ownerMfaEnrollRoute, ownerMfaConfirmRoute, ownerMfaRemoveRoute, ownerMfaStatusRoute].map((r) => `${r.method} ${r.path}`)).toEqual([
      'post /api/admin/v1/auth/mfa/enroll', 'post /api/admin/v1/auth/mfa/confirm', 'post /api/admin/v1/auth/mfa/remove', 'get /api/admin/v1/auth/mfa']);
    for (const route of [ownerMfaEnrollRoute, ownerMfaStatusRoute]) {
      expect(route.responseHeaders).toEqual({ 'Cache-Control': 'no-store' });
      expect(route.bufferedReply).toBe(true);
    }
    expect(ownerMfaEnrollRoute.readHeaders).toEqual(['sec-fetch-site', 'origin']);
  });

  it('refuses another origin, a cross-site fetch and a non-JSON body before admission', async () => {
    for (const [opts, headers] of [[{}, { origin: 'https://other.test' }], [{}, { 'sec-fetch-site': 'cross-site' }], [{ json: false }, {}]] as const) {
      const f = fixture(opts);
      const reply = await call(ownerMfaEnrollRoute, f.deps, { headers });
      expect(reply.status).toBe(403);
      expect(reply.body).toEqual({ error: 'Open this site’s security settings and submit the authenticator action there.', code: 'MFA_ORIGIN_REFUSED' });
      expect(reply.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(f.calls).toEqual([]);
    }
    // No Origin header at all is the same-origin form post: admitted.
    const f = fixture();
    expect((await call(ownerMfaEnrollRoute, f.deps, { headers: {} })).status).toBe(200);
  });

  it('refuses a missing admission, another principal and a non-session credential before rate or secret access', async () => {
    for (const opts of [{ caller: null }, { caller: 'staff' }, { kind: 'api_key' }]) {
      for (const route of [ownerMfaEnrollRoute, ownerMfaConfirmRoute, ownerMfaRemoveRoute]) {
        const f = fixture(opts);
        const reply = await call(route, f.deps);
        expect(reply.status).toBe(403);
        expect(reply.body).toEqual({ error: 'Sign in as the site owner to change this authenticator.', code: 'MFA_REFUSED', details: { operation: 'owner-authenticator' } });
        expect(f.calls).toEqual(['authenticate']);
      }
    }
  });

  it('answers a rate-limited owner 429 with Retry-After before any factor work', async () => {
    const f = fixture({ allowed: false });
    const reply = await call(ownerMfaRemoveRoute, f.deps);
    expect(reply.status).toBe(429);
    expect(reply.headers.get('retry-after')).toBe('60');
    expect(reply.body).toEqual({ error: 'Too many authenticator attempts. Wait a minute and try again.', code: 'RATE_LIMIT_EXCEEDED' });
    expect(f.calls).toEqual(['authenticate', 'rate']);
  });

  it('enrolls with the server-selected owner, the user label and the injected issuer; scalar body text only', async () => {
    const f = fixture();
    const reply = await call(ownerMfaEnrollRoute, f.deps, { body: { password: 'pw', code: 7, workspaceId: 'evil', principalId: 'evil' } });
    expect(reply).toMatchObject({ status: 200, body: { pendingToken: 'p', otpauthUrl: 'otpauth://x' } });
    expect(f.calls).toEqual(['authenticate', 'rate', 'mfaDeps',
      'begin:{"workspaceId":"site","principalId":"owner","password":"pw","code":"","label":"ada","issuer":"Site"}']);
  });

  it('maps a bad TOTP code to 400 and an unexpected failure to the host failure writer (rethrown, never disclosed)', async () => {
    const f = fixture();
    const bad = await call(ownerMfaConfirmRoute, f.deps, { body: { pendingToken: 't', code: 'bad' } });
    expect(bad).toMatchObject({ status: 400, body: { error: 'Code is not valid.', code: 'MFA_REFUSED', details: { operation: 'owner-authenticator' } } });
    const good = await call(ownerMfaConfirmRoute, fixture().deps, { body: { pendingToken: 't', code: '123456' } });
    expect(good.status).toBe(204);
    expect(good.body).toBeUndefined();
    await expect(call(ownerMfaRemoveRoute, fixture().deps)).rejects.toThrow('hunter2');
  });

  it('status discloses enrollment only to the owner session, never the sealed factor', async () => {
    const owner = fixture({ enrolled: true });
    const reply = await call(ownerMfaStatusRoute, owner.deps);
    expect(reply).toMatchObject({ status: 200, body: { isOwner: true, available: true, enrolled: true } });
    expect(JSON.stringify(reply.body)).not.toContain('never-return-this');
    for (const opts of [{ caller: null }, { caller: 'staff' }, { kind: 'api_key' }]) {
      const f = fixture({ ...opts, enrolled: true });
      expect((await call(ownerMfaStatusRoute, f.deps)).body).toEqual({ isOwner: false, available: false, enrolled: false });
      expect(f.calls).toEqual(['authenticate']);
    }
    expect((await call(ownerMfaStatusRoute, fixture({ store: false }).deps)).body).toEqual({ isOwner: true, available: false, enrolled: false });
  });

  it('status answers an OwnerRequiredError from admission as the 403 refusal', async () => {
    const f = fixture();
    f.deps.authenticate = async () => { throw new OwnerRequiredError({ message: 'no' }); };
    expect(await call(ownerMfaStatusRoute, f.deps)).toMatchObject({ status: 403, body: { error: 'no', code: 'MFA_REFUSED' } });
  });
});
